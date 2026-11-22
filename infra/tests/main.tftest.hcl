# Offline checks of the main stack: `tofu init -backend=false && tofu test` in infra/. The provider
# runs with placeholder credentials and makes no AWS call: the data sources that would read the
# account are overridden, and the policies, which name their resources by ARNs built from names,
# render for real at plan time.

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "placeholder"
  secret_key                  = "placeholder"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
}

variables {
  audit_tags   = { "inventory:project" = "splitwit" }
  image_digest = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
  alert_email  = "alerts@example.com"
}

override_data {
  target = data.aws_caller_identity.current
  values = { account_id = "000000000000" }
}

override_data {
  target = data.aws_ecr_repository.app
  values = { repository_url = "000000000000.dkr.ecr.us-east-1.amazonaws.com/splitwit" }
}

override_data {
  target = data.aws_acm_certificate.site
  values = { arn = "arn:aws:acm:us-east-1:000000000000:certificate/00000000-0000-0000-0000-000000000000" }
}

run "app_role_is_logs_and_textract" {
  command = plan

  assert {
    condition = toset(flatten([for s in jsondecode(data.aws_iam_policy_document.app.json).Statement : s.Action])) == toset([
      "logs:CreateLogStream", "logs:PutLogEvents", "textract:AnalyzeExpense",
    ])
    error_message = "The function's role may write its logs and call AnalyzeExpense, nothing else."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(data.aws_iam_policy_document.app.json).Statement :
      s.Sid == "Textract" || flatten([s.Resource]) == ["arn:aws:logs:us-east-1:000000000000:log-group:/aws/lambda/splitwit:*"]
    ])
    error_message = "Logs go to the function's own log group; only Textract, which has no ARNs, uses \"*\"."
  }

  assert {
    condition     = jsondecode(data.aws_iam_policy_document.app_trust.json).Statement[0].Principal.Service == "lambda.amazonaws.com"
    error_message = "Only Lambda assumes the function's role."
  }
}

run "function_runs_the_pinned_image" {
  command = plan

  assert {
    condition = (
      aws_lambda_function.app.package_type == "Image"
      && aws_lambda_function.app.image_uri == "000000000000.dkr.ecr.us-east-1.amazonaws.com/splitwit@sha256:0000000000000000000000000000000000000000000000000000000000000000"
      && aws_lambda_function.app.architectures == tolist(["arm64"])
      && aws_lambda_function.app.reserved_concurrent_executions == -1
    )
    error_message = "The function runs the image by digest on arm64, unreserved by default."
  }

  assert {
    condition     = aws_lambda_function.app.environment[0].variables == tomap({ OCR_PROVIDER = "textract", TEXTRACT_REGION = "us-east-1" })
    error_message = "The environment is the OCR provider and its region; no credentials or secrets."
  }

  assert {
    condition     = aws_lambda_function_url.app.authorization_type == "AWS_IAM"
    error_message = "The function URL needs a signed request."
  }
}

run "only_cloudfront_may_call_the_url" {
  command = plan

  assert {
    condition = (
      aws_lambda_permission.cloudfront_url.principal == "cloudfront.amazonaws.com"
      && aws_lambda_permission.cloudfront_url.action == "lambda:InvokeFunctionUrl"
      && aws_lambda_permission.cloudfront_url.function_url_auth_type == "AWS_IAM"
      && aws_lambda_permission.cloudfront_invoke.principal == "cloudfront.amazonaws.com"
      && aws_lambda_permission.cloudfront_invoke.action == "lambda:InvokeFunction"
      && aws_lambda_permission.cloudfront_invoke.invoked_via_function_url == true
    )
    error_message = "CloudFront, and only through the URL."
  }

  assert {
    condition = (
      aws_cloudfront_origin_access_control.app.origin_access_control_origin_type == "lambda"
      && aws_cloudfront_origin_access_control.app.signing_behavior == "always"
      && aws_cloudfront_origin_access_control.app.signing_protocol == "sigv4"
    )
    error_message = "Every origin request is signed."
  }
}

run "distribution" {
  command = plan

  assert {
    condition = (
      toset(aws_cloudfront_distribution.site.aliases) == toset(["splitwit.us", "www.splitwit.us"])
      && aws_cloudfront_distribution.site.viewer_certificate[0].minimum_protocol_version == "TLSv1.2_2021"
      && aws_cloudfront_distribution.site.viewer_certificate[0].ssl_support_method == "sni-only"
    )
    error_message = "The two names, SNI, TLS 1.2 or later."
  }

  assert {
    condition = alltrue([
      for o in aws_cloudfront_distribution.site.origin :
      o.custom_origin_config[0].origin_protocol_policy == "https-only" && o.custom_origin_config[0].origin_ssl_protocols == toset(["TLSv1.2"])
    ])
    error_message = "CloudFront reaches the origin over TLS 1.2 only."
  }

  assert {
    condition = (
      aws_cloudfront_distribution.site.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https"
      && aws_cloudfront_distribution.site.default_cache_behavior[0].cache_policy_id == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
      && aws_cloudfront_distribution.site.default_cache_behavior[0].origin_request_policy_id == "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    )
    error_message = "Pages and the API: HTTPS, never cached, every viewer header but Host forwarded."
  }

  assert {
    condition = alltrue(concat(
      [for f in aws_cloudfront_distribution.site.default_cache_behavior[0].function_association : f.event_type == "viewer-request"],
      [for b in aws_cloudfront_distribution.site.ordered_cache_behavior : b.viewer_protocol_policy == "redirect-to-https" && length(b.function_association) == 1],
    ))
    error_message = "Every behaviour redirects to HTTPS and runs the www redirect."
  }

  assert {
    condition = alltrue(concat(
      [for b in aws_cloudfront_distribution.site.default_cache_behavior : (b.response_headers_policy_id == null || b.response_headers_policy_id == "")],
      [for b in aws_cloudfront_distribution.site.ordered_cache_behavior : (b.response_headers_policy_id == null || b.response_headers_policy_id == "")],
    ))
    error_message = "No response headers policy (the Free plan has no custom header rules): the app sends its own."
  }

  assert {
    condition     = strcontains(aws_cloudfront_function.www_redirect.code, "var APEX = 'splitwit.us';") && !strcontains(aws_cloudfront_function.www_redirect.code, "APEX_HOST")
    error_message = "The redirect function names the apex."
  }
}

run "keep_warm_invokes_the_function_only" {
  command = plan

  assert {
    condition = (
      aws_scheduler_schedule.keep_warm[0].schedule_expression == "rate(5 minutes)"
      && jsondecode(data.aws_iam_policy_document.keep_warm.json).Statement[0].Action == "lambda:InvokeFunction"
      && jsondecode(data.aws_iam_policy_document.keep_warm.json).Statement[0].Resource == "arn:aws:lambda:us-east-1:000000000000:function:splitwit"
      && jsondecode(data.aws_iam_policy_document.keep_warm_trust.json).Statement[0].Condition.StringEquals["aws:SourceAccount"] == "000000000000"
    )
    error_message = "Every 5 minutes, by a role that may invoke this function and nothing else."
  }
}

run "keep_warm_off" {
  command = plan

  variables {
    keep_warm = false
  }

  assert {
    condition     = length(aws_scheduler_schedule.keep_warm) == 0 && length(aws_iam_role.keep_warm) == 0
    error_message = "No schedule and no role when keep_warm is false."
  }
}

run "reserved_concurrency_set" {
  command = plan

  variables {
    reserved_concurrency = 5
  }

  assert {
    condition     = aws_lambda_function.app.reserved_concurrent_executions == 5
    error_message = "The reservation is applied when set."
  }
}

run "budget_stop_touches_the_app_role_only" {
  command = plan

  assert {
    condition = (
      toset(jsondecode(data.aws_iam_policy_document.budgets_action.json).Statement[0].Action) == toset(["iam:AttachRolePolicy", "iam:DetachRolePolicy"])
      && jsondecode(data.aws_iam_policy_document.budgets_action.json).Statement[0].Resource == "arn:aws:iam::000000000000:role/splitwit-app"
      && jsondecode(data.aws_iam_policy_document.budgets_action.json).Statement[0].Condition.ArnEquals["iam:PolicyARN"] == "arn:aws:iam::000000000000:policy/splitwit-ocr-stop"
    )
    error_message = "Budgets may attach or detach the stop policy on the app role, nothing else."
  }

  assert {
    condition     = aws_budgets_budget_action.stop_ocr.definition[0].iam_action_definition[0].roles == toset(["splitwit-app"])
    error_message = "The stop applies to the function's role."
  }
}

run "image_digest_refuses_a_tag" {
  command = plan

  variables {
    image_digest = "latest"
  }

  expect_failures = [var.image_digest]
}

run "reserved_concurrency_refuses_zero" {
  command = plan

  variables {
    reserved_concurrency = 0
  }

  expect_failures = [var.reserved_concurrency]
}

run "rate_limit_on_api_posts" {
  command = plan

  assert {
    condition = (
      aws_wafv2_web_acl.site[0].scope == "CLOUDFRONT" && aws_wafv2_web_acl.site[0].region == "us-east-1"
      && length(aws_wafv2_web_acl.site[0].default_action[0].allow) == 1
      && length(aws_wafv2_web_acl.site[0].rule) == 1
    )
    error_message = "A CloudFront web ACL in us-east-1 that allows by default and has one rule."
  }

  assert {
    condition = alltrue([
      for r in aws_wafv2_web_acl.site[0].rule :
      length(r.action[0].block) == 1
      && r.statement[0].rate_based_statement[0].limit == 30
      && r.statement[0].rate_based_statement[0].evaluation_window_sec == 300
      && r.statement[0].rate_based_statement[0].aggregate_key_type == "IP"
    ])
    error_message = "The rule blocks an address over 30 requests in five minutes."
  }

  assert {
    condition = alltrue([
      for r in aws_wafv2_web_acl.site[0].rule : jsonencode([
        for s in r.statement[0].rate_based_statement[0].scope_down_statement[0].and_statement[0].statement : [
          s.byte_match_statement[0].search_string, s.byte_match_statement[0].positional_constraint,
          join(",", [for t in s.byte_match_statement[0].text_transformation : t.type]),
        ]
      ]) == jsonencode([["POST", "EXACTLY", "NONE"], ["/api/", "STARTS_WITH", "URL_DECODE,NORMALIZE_PATH,LOWERCASE"]])
    ])
    error_message = "It counts POSTs to /api/ only, on the decoded, normalised, lower-cased path."
  }

  assert {
    condition = alltrue([
      for r in aws_wafv2_web_acl.site[0].rule :
      length(r.statement[0].managed_rule_group_statement) == 0 && length(r.statement[0].rule_group_reference_statement) == 0
    ])
    error_message = "No managed rule groups (the Core rule set would block every upload)."
  }

  assert {
    condition = (
      aws_pricingplanmanager_subscription.site[0].plan_family == "CloudFront"
      && aws_pricingplanmanager_subscription.site[0].plan_tier == "FREE"
      && aws_pricingplanmanager_subscription.site[0].approval_mode == "IMMEDIATE"
    )
    error_message = "The distribution and the web ACL on CloudFront's Free plan."
  }
}

run "flat_rate_plan_off" {
  command = plan

  variables {
    flat_rate_plan = false
  }

  assert {
    condition = (
      length(aws_wafv2_web_acl.site) == 0 && length(aws_pricingplanmanager_subscription.site) == 0
      && aws_cloudfront_distribution.site.web_acl_id == null
    )
    error_message = "No web ACL, no subscription, and no web ACL on the distribution, so nothing bills."
  }
}

run "api_post_limit_refuses_below_waf_least" {
  command = plan

  variables {
    api_post_limit = 5
  }

  expect_failures = [var.api_post_limit]
}
