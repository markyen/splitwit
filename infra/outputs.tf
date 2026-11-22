output "distribution_domain" {
  description = "The <id>.cloudfront.net name the apex and www CNAMEs point at (infra/dns), DNS-only."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "function_url" {
  description = "The function's own URL. It refuses requests that CloudFront didn't sign."
  value       = aws_lambda_function_url.app.function_url
}

output "image_uri" {
  description = "The image the function runs, by digest."
  value       = aws_lambda_function.app.image_uri
}

output "budget_name" {
  description = "The Budgets budget whose action stops Textract; reverse the action there to resume."
  value       = aws_budgets_budget.textract.name
}

output "flat_rate_plan" {
  description = "The CloudFront flat-rate subscription's status, or null without the plan."
  value       = one(aws_pricingplanmanager_subscription.site[*].status)
}

output "alerts_topic_arn" {
  description = "The SNS topic the alarms publish to; deploy.sh checks its email subscription is confirmed."
  value       = aws_sns_topic.alerts.arn
}
