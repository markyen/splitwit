# The app: one Lambda function running the image deploy.sh built, behind a function URL that only
# CloudFront can call (cdn.tf). Its role may write its own logs and call Textract; nothing else.

locals {
  account   = data.aws_caller_identity.current.account_id
  partition = data.aws_partition.current.partition

  function      = "splitwit"
  app_role      = "splitwit-app"
  log_group     = "/aws/lambda/${local.function}"
  log_group_arn = "arn:${local.partition}:logs:${var.aws_region}:${local.account}:log-group:${local.log_group}"
  function_arn  = "arn:${local.partition}:lambda:${var.aws_region}:${local.account}:function:${local.function}"
}

data "aws_partition" "current" {}

# Made by infra/bootstrap; read here for its URL
data "aws_ecr_repository" "app" {
  name = "splitwit"
}

data "aws_iam_policy_document" "app_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name                 = local.app_role
  description          = "The splitwit function's execution role: its own logs and Textract AnalyzeExpense"
  assume_role_policy   = data.aws_iam_policy_document.app_trust.json
  max_session_duration = 3600
  permissions_boundary = var.permissions_boundary_arn
}

# Textract has no resource ARNs, so its one action is allowed on "*". The Budgets stop attaches a
# deny of that action to this role (budget.tf).
data "aws_iam_policy_document" "app" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${local.log_group_arn}:*"]
  }

  statement {
    sid       = "Textract"
    actions   = ["textract:AnalyzeExpense"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "app" {
  name   = "logs-and-textract"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_cloudwatch_log_group" "app" {
  name              = local.log_group
  retention_in_days = 30
}

# The image by digest, never by tag, so the plan names exactly the bytes that will run
resource "aws_lambda_function" "app" {
  function_name                  = local.function
  role                           = aws_iam_role.app.arn
  package_type                   = "Image"
  image_uri                      = "${data.aws_ecr_repository.app.repository_url}@${var.image_digest}"
  architectures                  = ["arm64"]
  memory_size                    = 1024
  timeout                        = 30
  reserved_concurrent_executions = coalesce(var.reserved_concurrency, -1)

  environment {
    variables = {
      OCR_PROVIDER    = "textract"
      TEXTRACT_REGION = var.aws_region
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.app.name
  }

  depends_on = [aws_iam_role_policy.app]
}

# AWS_IAM: a request must be signed by a principal the function's policy admits, and the only one
# admitted is this distribution (cdn.tf), so the URL can't be called around CloudFront
resource "aws_lambda_function_url" "app" {
  function_name      = aws_lambda_function.app.function_name
  authorization_type = "AWS_IAM"
  invoke_mode        = "BUFFERED"
}

# The keep-warm: a scheduled invoke every 5 minutes. The adapter passes a non-HTTP event to the
# app's /events path, which answers 404; the instance is warm either way.
data "aws_iam_policy_document" "keep_warm_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account]
    }
  }
}

resource "aws_iam_role" "keep_warm" {
  count                = var.keep_warm ? 1 : 0
  name                 = "splitwit-keep-warm"
  description          = "Assumed by EventBridge Scheduler to invoke the splitwit function every 5 minutes"
  assume_role_policy   = data.aws_iam_policy_document.keep_warm_trust.json
  max_session_duration = 3600
  permissions_boundary = var.permissions_boundary_arn
}

data "aws_iam_policy_document" "keep_warm" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [local.function_arn]
  }
}

resource "aws_iam_role_policy" "keep_warm" {
  count  = var.keep_warm ? 1 : 0
  name   = "invoke-splitwit"
  role   = aws_iam_role.keep_warm[0].id
  policy = data.aws_iam_policy_document.keep_warm.json
}

resource "aws_scheduler_schedule" "keep_warm" {
  count               = var.keep_warm ? 1 : 0
  name                = "splitwit-keep-warm"
  schedule_expression = "rate(5 minutes)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.app.arn
    role_arn = aws_iam_role.keep_warm[0].arn
    input    = jsonencode({ source = "splitwit.keep-warm" })

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}
