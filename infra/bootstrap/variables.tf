variable "aws_region" {
  description = "Where the image repository, the source bucket and the build run. Keep it equal to the main stack's."
  type        = string
  default     = "us-east-1"
}

variable "hostnames" {
  description = "The site's names, apex first; the certificate covers them all. Keep it equal to the main stack's."
  type        = list(string)
  default     = ["splitwit.us", "www.splitwit.us"]

  validation {
    condition     = length(var.hostnames) == 2 && var.hostnames[1] == "www.${var.hostnames[0]}"
    error_message = "The apex, then www under it."
  }
}

variable "firebase_web_config" {
  description = <<-EOT
    The six NEXT_PUBLIC_FIREBASE_* values the browser bundle is built with, keyed by the part after
    the prefix (API_KEY, AUTH_DOMAIN, PROJECT_ID, STORAGE_BUCKET, MESSAGING_SENDER_ID, APP_ID). They
    are public web config, guarded by firestore.rules, but they name the Firebase project, so they
    live in the gitignored tfvars and the build's environment rather than in the repository.
  EOT
  type        = map(string)

  validation {
    condition = (
      toset(keys(var.firebase_web_config)) == toset(["API_KEY", "AUTH_DOMAIN", "PROJECT_ID", "STORAGE_BUCKET", "MESSAGING_SENDER_ID", "APP_ID"])
      && alltrue([for value in values(var.firebase_web_config) : can(regex("^[A-Za-z0-9._:-]+$", value))])
    )
    error_message = "Exactly the six keys API_KEY, AUTH_DOMAIN, PROJECT_ID, STORAGE_BUCKET, MESSAGING_SENDER_ID and APP_ID, each a non-empty value without spaces or quotes."
  }
}

variable "audit_tags" {
  description = "Tags on every resource, for an inventory of the account (set in the gitignored terraform.tfvars.json)."
  type        = map(string)
  default     = {}
}
