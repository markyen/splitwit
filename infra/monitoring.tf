# Two alarms. More Textract requests in an hour than the app's users could make: the route is open
# (gated by a share code), so this is the spend alert. And function errors: the adapter turns an
# app's 500 into a normal response, so these are crashes, timeouts and out-of-memory, not bad pages.

resource "aws_sns_topic" "alerts" {
  name = "splitwit-alerts"
}

# AWS emails a confirmation link; alerts arrive only after it is clicked.
resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "textract_requests" {
  alarm_name          = "splitwit-textract-requests"
  alarm_description   = "More than 60 Textract AnalyzeExpense requests in an hour."
  namespace           = "AWS/Textract"
  metric_name         = "SuccessfulRequestCount"
  dimensions          = { Operation = "AnalyzeExpense" }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 60
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "splitwit-lambda-errors"
  alarm_description   = "More than 10 splitwit function errors in 5 minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.app.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
