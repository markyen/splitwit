# The spend stop. The route is open to anyone who creates an expense, so the request alarm alone
# cannot bound cost. Once the month's Textract spend passes the limit, an AWS Budgets action
# attaches a deny policy to the function's role; scans then fall back to the browser's OCR.
#
# It is a backstop, not a cap: Budgets reads billing data a few times a day and that data lags, so
# the stop can come up to about a day after spend passes the limit. The hourly request alarm is
# the fast signal. The deny stays attached into the next month. To resume, reverse the action in
# the Budgets console or, if it no longer offers that, detach the policy:
#   aws iam detach-role-policy --role-name splitwit-app --policy-arn <splitwit-ocr-stop's ARN>
# An action that has run may not run again in the same month, so a mid-month resume leaves the
# rest of that month without the stop.

data "aws_caller_identity" "current" {}

locals {
  stop_policy = "splitwit-ocr-stop"
}

resource "aws_budgets_budget" "textract" {
  name         = "splitwit-textract"
  budget_type  = "COST"
  limit_amount = var.textract_monthly_limit_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "Service"
    values = ["Amazon Textract"]
  }

  # Credits and refunds would hide the spend the stop exists to catch
  cost_types {
    include_credit = false
    include_refund = false
  }
}

# Attached by the action; denies the role's one permission.
data "aws_iam_policy_document" "ocr_stop" {
  statement {
    effect    = "Deny"
    actions   = ["textract:AnalyzeExpense"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "ocr_stop" {
  name        = local.stop_policy
  description = "Attached to splitwit-app by the Budgets action when Textract spend passes the monthly limit"
  policy      = data.aws_iam_policy_document.ocr_stop.json
}

# The role Budgets assumes to run the action: it may attach or detach that one policy on that one
# role, nothing else.
data "aws_iam_policy_document" "budgets_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:budgets::${data.aws_caller_identity.current.account_id}:budget/*"]
    }
  }
}

resource "aws_iam_role" "budgets_action" {
  name                 = "splitwit-budgets-action"
  description          = "Assumed by AWS Budgets to attach splitwit-ocr-stop to splitwit-app"
  assume_role_policy   = data.aws_iam_policy_document.budgets_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "budgets_action" {
  statement {
    actions   = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
    resources = ["arn:${local.partition}:iam::${local.account}:role/${local.app_role}"]
    condition {
      test     = "ArnEquals"
      variable = "iam:PolicyARN"
      values   = ["arn:${local.partition}:iam::${local.account}:policy/${local.stop_policy}"]
    }
  }
}

resource "aws_iam_role_policy" "budgets_action" {
  name   = "attach-ocr-stop"
  role   = aws_iam_role.budgets_action.id
  policy = data.aws_iam_policy_document.budgets_action.json
}

resource "aws_budgets_budget_action" "stop_ocr" {
  budget_name        = aws_budgets_budget.textract.name
  action_type        = "APPLY_IAM_POLICY"
  approval_model     = "AUTOMATIC"
  notification_type  = "ACTUAL"
  execution_role_arn = aws_iam_role.budgets_action.arn

  action_threshold {
    action_threshold_type  = "PERCENTAGE"
    action_threshold_value = 100
  }

  definition {
    iam_action_definition {
      policy_arn = aws_iam_policy.ocr_stop.arn
      roles      = [aws_iam_role.app.name]
    }
  }

  subscriber {
    address           = var.alert_email
    subscription_type = "EMAIL"
  }
}
