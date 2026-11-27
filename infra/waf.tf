# CloudFront's flat-rate Free plan ($0 a month, no overage charges), which covers the distribution
# and one web ACL. The web ACL has one rule, the plan's IP-based rate limiting as it comes: an
# address that sends more than rate_per_address_limit requests in five minutes is blocked until its
# rate falls. It counts every request, pages, static assets and API calls alike, so it bounds how
# many Lambda calls one address can drive, the two API routes (Textract and receipt links) among
# them. There is no scope-down statement, so no match conditions or text transformations, none of
# which the plan lists.
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
  description = "Rate limit on requests from one address"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-per-address"
    priority = 0

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit                 = var.rate_per_address_limit
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "splitwit-rate-per-address"
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
