output "serve_from" {
  description = "Where the apex and www point now. deploy.sh --dns apply keeps it."
  value       = var.serve_from
}

output "proxied" {
  description = "Whether Cloudflare proxies the apex and www."
  value       = var.proxied
}

output "adoptable" {
  description = "Records in the zone that match one here: this stack's key to Cloudflare's record id."
  value       = local.adoptable
}

output "imports" {
  description = "The records this run imports: adoptable with adopt, otherwise none."
  value       = local.imports
}
