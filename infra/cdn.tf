# CloudFront in front of the function URL: the site's names and certificate, HTTPS only (port 80
# redirects), the www to apex redirect at the edge, and requests to the origin signed with origin
# access control. The security headers come from the app (next.config.ts) and pass through: the
# flat-rate Free plan (waf.tf) has no custom response header rules.
#
# Signing has one cost for the app: Lambda accepts a signed POST only when the viewer sent the
# body's SHA-256 in x-amz-content-sha256, which the browser does (src/services/post.ts).

locals {
  apex = var.hostnames[0]

  # The function URL is https://<id>.lambda-url.<region>.on.aws/; the origin wants the bare host
  origin_host = trimsuffix(trimprefix(aws_lambda_function_url.app.function_url, "https://"), "/")

  # AWS managed policies, by their documented ids
  cache_disabled         = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
  cache_optimized        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
  all_viewer_except_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # Managed-AllViewerExceptHostHeader
}

# Made by infra/bootstrap and validated through infra/dns; the plan fails here until it is issued
data "aws_acm_certificate" "site" {
  region      = "us-east-1"
  domain      = local.apex
  statuses    = ["ISSUED"]
  most_recent = true
}

resource "aws_cloudfront_origin_access_control" "app" {
  name                              = "splitwit-lambda"
  description                       = "Signs CloudFront's requests to the splitwit function URL"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "www_redirect" {
  name    = "splitwit-www-redirect"
  comment = "301 from www to the apex"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = replace(file("${path.module}/cdn/www-redirect.js"), "APEX_HOST", local.apex)
}

resource "aws_cloudfront_distribution" "site" {
  enabled         = true
  comment         = "splitwit"
  aliases         = var.hostnames
  is_ipv6_enabled = true
  http_version    = "http2and3"
  # Every edge location: a flat-rate plan covers the whole network
  price_class = "PriceClass_All"
  web_acl_id  = one(aws_wafv2_web_acl.site[*].arn)

  origin {
    origin_id                = "lambda"
    domain_name              = local.origin_host
    origin_access_control_id = aws_cloudfront_origin_access_control.app.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Pages and the API: never cached, every viewer header but Host forwarded (the signature needs
  # the function URL's own host). POST needs the full method set.
  default_cache_behavior {
    target_origin_id         = "lambda"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = local.cache_disabled
    origin_request_policy_id = local.all_viewer_except_host

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_redirect.arn
    }
  }

  # Next's hashed build assets: immutable, so cached at the edge
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "lambda"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = local.cache_optimized

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_redirect.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = data.aws_acm_certificate.site.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# The function URL admits this distribution and nothing else. Lambda asks for both permissions on a
# function URL: InvokeFunctionUrl, and InvokeFunction limited to calls that arrive through the URL.
resource "aws_lambda_permission" "cloudfront_url" {
  statement_id           = "CloudFrontInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.app.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.site.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "cloudfront_invoke" {
  statement_id             = "CloudFrontInvokeFunctionViaUrl"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.app.function_name
  principal                = "cloudfront.amazonaws.com"
  source_arn               = aws_cloudfront_distribution.site.arn
  invoked_via_function_url = true
}
