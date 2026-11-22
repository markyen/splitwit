# CloudFront's flat-rate Free plan ($0 a month, no overage charges), which covers the distribution
# and one web ACL. The web ACL has one rule: an address that sends more than api_post_limit POSTs to
# /api/ in five minutes is blocked until its rate falls. The two API routes call Textract and fetch
# receipt links, so they are what costs money when abused.
#
# No AWS managed rule groups. The Core rule set's SizeRestrictions_BODY blocks any request body
# over 8 KB, and every receipt upload and OCR request is larger; the app has no SQL or PHP for the
# other sets to guard. A rate rule never reads the body, so the plan's 16 KB body-inspection limit
# doesn't apply to it.
#
# If the plan refuses the subscription (a rule it doesn't allow, or this origin), deploy.sh applies
# flat_rate_plan = false at once, so no web ACL is left to bill on pay-as-you-go.

resource "aws_wafv2_web_acl" "site" {
  count = var.flat_rate_plan ? 1 : 0

  # A CloudFront web ACL lives in us-east-1
  region      = "us-east-1"
  name        = "splitwit"
  description = "Rate limit on POSTs to the API"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "api-post-rate"
    priority = 0

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit                 = var.api_post_limit
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"

        scope_down_statement {
          and_statement {
            statement {
              byte_match_statement {
                search_string         = "POST"
                positional_constraint = "EXACTLY"
                field_to_match {
                  method {}
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }

            # Every route under /api/, matched after decoding and normalising the path, so
            # neither %-escapes, case nor doubled slashes step around it
            statement {
              byte_match_statement {
                search_string         = "/api/"
                positional_constraint = "STARTS_WITH"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "URL_DECODE"
                }
                text_transformation {
                  priority = 1
                  type     = "NORMALIZE_PATH"
                }
                text_transformation {
                  priority = 2
                  type     = "LOWERCASE"
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "splitwit-api-post-rate"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "splitwit"
    sampled_requests_enabled   = true
  }
}

resource "aws_pricingplanmanager_subscription" "site" {
  count = var.flat_rate_plan ? 1 : 0

  plan_family = "CloudFront"
  plan_tier   = "FREE"
  # The Free tier takes IMMEDIATE only; a paid tier would wait for a separate approval
  approval_mode = "IMMEDIATE"
  resource_arns = [aws_cloudfront_distribution.site.arn, aws_wafv2_web_acl.site[0].arn]
}
