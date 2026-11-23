variable "image_digest" {
  description = "The digest of the image to run, as deploy.sh read it back from ECR after the build (sha256:<64 hex>)."
  type        = string

  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.image_digest))
    error_message = "An image digest, sha256: and 64 lowercase hex digits."
  }
}

variable "alert_email" {
  description = "Where the alarms' emails go (AWS sends a confirmation link first), and the Budgets stop's notice."
  type        = string
}

variable "aws_region" {
  description = "Where the function runs and the alarms watch Textract; the app calls Textract in the same region."
  type        = string
  default     = "us-east-1"
}

variable "hostnames" {
  description = "The site's names, apex first. Keep it equal to infra/bootstrap's, whose certificate covers them."
  type        = list(string)
  default     = ["splitwit.us", "www.splitwit.us"]

  validation {
    condition     = length(var.hostnames) == 2 && var.hostnames[1] == "www.${var.hostnames[0]}"
    error_message = "The apex, then www under it."
  }
}

variable "reserved_concurrency" {
  description = <<-EOT
    Instances the function may run at once, which bounds the OCR route's request rate and the bill.
    null leaves the function unreserved: an account whose concurrency quota is still 10 cannot
    reserve any, since Lambda keeps 10 unreserved. Read the quota first (aws lambda
    get-account-settings) and set 5 once it is above 10.
  EOT
  type        = number
  default     = null

  validation {
    condition     = var.reserved_concurrency == null || try(var.reserved_concurrency >= 1 && var.reserved_concurrency <= 20, false)
    error_message = "null, or a whole number from 1 to 20."
  }
}

variable "keep_warm" {
  description = "Invoke the function every 5 minutes so one instance stays warm."
  type        = bool
  default     = true
}

variable "textract_monthly_limit_usd" {
  description = "Textract spend in a month, in US dollars, past which the Budgets action takes the function's Textract permission away."
  type        = string
  default     = "5"

  validation {
    condition     = can(regex("^[0-9]+(\\.[0-9]{1,2})?$", var.textract_monthly_limit_usd)) && tonumber(var.textract_monthly_limit_usd) > 0
    error_message = "A positive dollar amount, such as \"5\" or \"2.50\"."
  }
}

variable "flat_rate_plan" {
  description = <<-EOT
    true: subscribe the distribution to CloudFront's flat-rate Free plan, with the web ACL that
    rate-limits POSTs to the API (waf.tf). false: neither, and the distribution is pay-as-you-go.
    deploy.sh applies false by itself if the plan refuses the subscription.
  EOT
  type        = bool
  default     = true
}

variable "api_post_limit" {
  description = "POSTs to /api/ one address may make in five minutes before the web ACL blocks it, until its rate falls."
  type        = number
  default     = 30

  validation {
    condition     = var.api_post_limit >= 10 && var.api_post_limit <= 2000 && floor(var.api_post_limit) == var.api_post_limit
    error_message = "A whole number from 10 (WAF's least) to 2000."
  }
}

variable "audit_tags" {
  description = "Tags on every resource, for an inventory of the account (set in the gitignored terraform.tfvars.json)."
  type        = map(string)
  default     = {}
}

variable "permissions_boundary_arn" {
  description = <<-EOT
    The ARN of a managed policy to set as the permissions boundary of splitwit's roles (splitwit-app,
    splitwit-keep-warm, splitwit-budgets-action and splitwit-build, across infra/ and
    infra/bootstrap/), for a deploy role that may make or change roles only with that boundary. null
    sets none. Set it in both stacks' gitignored terraform.tfvars.json; deploy.sh --attach-boundary
    applies it.
  EOT
  type        = string
  default     = null

  validation {
    condition     = var.permissions_boundary_arn == null || can(regex("^arn:aws[a-z-]*:iam::[0-9]{12}:policy/.+$", var.permissions_boundary_arn))
    error_message = "null, or an IAM managed policy ARN (arn:aws:iam::<account>:policy/<name>)."
  }
}
