variable "zone_id" {
  description = "The Cloudflare zone id of splitwit.us (the zone's Overview page). Kept in the gitignored tfvars."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.zone_id))
    error_message = "A Cloudflare zone id, 32 lowercase hex digits."
  }
}

variable "apex" {
  description = "The zone's apex; www is under it."
  type        = string
  default     = "splitwit.us"
}

variable "serve_from" {
  description = <<-EOT
    Where the apex and www point. "vercel": Vercel's addresses, as before the move. "cloudfront":
    the distribution, as CNAMEs (flattened at the apex). The cutover is this one change, and so is
    its rollback.
  EOT
  type        = string
  default     = "vercel"

  validation {
    condition     = contains(["vercel", "cloudfront"], var.serve_from)
    error_message = "\"vercel\" or \"cloudfront\"."
  }
}

variable "vercel_addresses" {
  description = "Vercel's A records for the apex and www, as its DNS served them before the move. The first is the one replaced at the cutover."
  type        = list(string)
  default     = ["64.29.17.65", "216.198.79.65"]

  validation {
    condition     = length(var.vercel_addresses) >= 1 && alltrue([for a in var.vercel_addresses : can(cidrhost("${a}/32", 0))])
    error_message = "One or more IPv4 addresses."
  }
}

variable "distribution_domain" {
  description = "The CloudFront distribution's <id>.cloudfront.net name (the main stack's distribution_domain output). Needed for serve_from = \"cloudfront\"."
  type        = string
  default     = null

  validation {
    condition     = var.distribution_domain == null || can(regex("^[a-z0-9]+\\.cloudfront\\.net$", var.distribution_domain))
    error_message = "A CloudFront distribution name, <id>.cloudfront.net."
  }
}

variable "vercel_retired" {
  description = <<-EOT
    true once the Vercel project is deleted: CAA then admits Amazon alone. Until then Vercel's
    certificate authorities stay admitted, so its certificate can renew while rollback is possible.
  EOT
  type        = bool
  default     = false
}

variable "acm_validation_records" {
  description = "The certificate's validation CNAMEs, as infra/bootstrap's acm_validation_records output gives them."
  type = list(object({
    domain = string
    name   = string
    type   = string
    value  = string
  }))
  default = []

  validation {
    condition = alltrue([
      for r in var.acm_validation_records :
      r.type == "CNAME" && can(regex("^_[0-9a-f]+\\.", r.name)) && can(regex("\\.acm-validations\\.aws\\.?$", r.value))
    ])
    error_message = "Each record is an ACM validation CNAME: _<hex>.<name> to <...>.acm-validations.aws."
  }
}

variable "record_ttl" {
  description = "TTL in seconds of every record that isn't proxied. Five minutes, so a cutover or a rollback is seen within that."
  type        = number
  default     = 300

  validation {
    condition     = var.record_ttl >= 60 && var.record_ttl <= 86400
    error_message = "Between 60 and 86400 seconds."
  }
}

variable "proxied" {
  description = <<-EOT
    Whether Cloudflare proxies the apex and www. false: DNS only, and the site's own certificate
    (Vercel's, then CloudFront's) serves. true: Cloudflare's edge terminates TLS in front of it.
  EOT
  type        = bool
  default     = false
}

variable "adopt" {
  description = "true for deploy.sh --dns adopt only: records already in the zone that match a record here are imported, by existing_records."
  type        = bool
  default     = false
}

variable "existing_records" {
  description = "The zone's records as Cloudflare lists them (deploy.sh fetches them for each run). Used to import, with adopt."
  type = list(object({
    id       = string
    type     = string
    name     = string
    content  = optional(string, "")
    priority = optional(number)
    tag      = optional(string)
    value    = optional(string)
  }))
  default = []

  validation {
    condition     = alltrue([for r in var.existing_records : can(regex("^[0-9a-f]{32}$", r.id))])
    error_message = "Each record id is 32 lowercase hex digits."
  }
}
