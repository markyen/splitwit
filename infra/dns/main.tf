locals {
  www = "www.${var.apex}"

  # The apex and www: one record each, an A record to Vercel's first address or a CNAME to the
  # distribution (flattened at the apex). The cutover changes the type, which can't be done in
  # place, so each is replaced: deleted, then created, as a CNAME can't share its name.
  site = {
    for key, name in { apex = var.apex, www = local.www } : key => (
      var.serve_from == "cloudfront"
      ? { name = name, type = "CNAME", content = var.distribution_domain }
      : { name = name, type = "A", content = var.vercel_addresses[0] }
    )
  }

  # Vercel's other addresses, while it serves
  vercel_extra = var.serve_from == "vercel" ? {
    for pair in setproduct(["apex", "www"], slice(var.vercel_addresses, 1, length(var.vercel_addresses))) :
    "${pair[0]} ${pair[1]}" => { name = pair[0] == "apex" ? var.apex : local.www, type = "A", content = pair[1] }
  } : {}

  # CAA: Amazon for CloudFront's certificate, and Vercel's authorities until Vercel is retired. No
  # wildcard certificate is wanted, so none may be issued; but while proxied, Cloudflare's edge
  # certificate is a wildcard and Cloudflare adds its own authorities, which ";" would contradict.
  caa = concat(var.vercel_retired ? [] : ["letsencrypt.org", "pki.goog", "sectigo.com"], ["amazon.com"])

  zone_records = merge(
    { for ca in local.caa : "caa issue ${ca}" => { name = var.apex, type = "CAA", tag = "issue", value = ca } },
    var.proxied ? {} : { "caa issuewild ;" = { name = var.apex, type = "CAA", tag = "issuewild", value = ";" } },
    {
      # The domain sends no mail, and says so: a null MX, an SPF that permits no sender, DMARC reject
      mx    = { name = var.apex, type = "MX", content = ".", priority = 0 }
      spf   = { name = var.apex, type = "TXT", content = "v=spf1 -all" }
      dmarc = { name = "_dmarc.${var.apex}", type = "TXT", content = "v=DMARC1; p=reject" }
    },
    { for r in var.acm_validation_records : "acm ${trimsuffix(r.name, ".")}" => {
      name = trimsuffix(r.name, "."), type = "CNAME", content = trimsuffix(r.value, ".")
    } },
  )
  blank = { content = "", priority = -1, tag = "", value = "" }
  zone  = { for k, r in local.zone_records : k => merge(local.blank, r) }

  # --- adopting the records already in the zone -------------------------------------------------
  # A record here and a record in the zone are the same record when their signatures match: type,
  # name and value, ignoring case, a trailing dot, TXT quotes, the TTL and the proxy setting.
  wanted = merge(
    { for k, r in local.site : "site/${k}" => merge(local.blank, { for a, v in r : a => v if v != null }) },
    { for k, r in local.vercel_extra : "vercel_extra/${k}" => merge(local.blank, r) },
    { for k, r in local.zone : "zone/${k}" => r },
  )
  signatures = {
    for k, r in merge(
      { for k, r in local.wanted : "want ${k}" => r },
      { for r in var.existing_records : "have ${r.id}" => merge(local.blank, { for a, v in r : a => v if v != null }) },
    ) :
    k => join(" ", [
      upper(r.type),
      lower(trimsuffix(r.name, ".")),
      r.type == "CAA" ? "${r.tag} ${r.value}" : r.type == "TXT" ? trim(r.content, "\"") : r.type == "MX" ? "${r.priority} ${lower(r.content)}" : lower(trimsuffix(r.content, ".")),
    ])
  }
  existing = { for k, s in local.signatures : trimprefix(k, "have ") => s if startswith(k, "have ") }
  matches = {
    for k, s in local.signatures : trimprefix(k, "want ") => [for id, e in local.existing : id if e == s]
    if startswith(k, "want ")
  }
  # A record here and the one record in the zone that matches it, if exactly one does. Imported only
  # with adopt; deploy.sh stops if any record in the zone is then neither imported nor in the state.
  adoptable = { for k, ids in local.matches : k => ids[0] if length(ids) == 1 }
  imports   = var.adopt ? local.adoptable : {}
}

import {
  for_each = { for k, id in local.imports : trimprefix(k, "site/") => id if startswith(k, "site/") }
  to       = cloudflare_dns_record.site[each.key]
  id       = "${var.zone_id}/${each.value}"
}

import {
  for_each = { for k, id in local.imports : trimprefix(k, "vercel_extra/") => id if startswith(k, "vercel_extra/") }
  to       = cloudflare_dns_record.vercel_extra[each.key]
  id       = "${var.zone_id}/${each.value}"
}

import {
  for_each = { for k, id in local.imports : trimprefix(k, "zone/") => id if startswith(k, "zone/") }
  to       = cloudflare_dns_record.zone[each.key]
  id       = "${var.zone_id}/${each.value}"
}

resource "cloudflare_dns_record" "site" {
  for_each = local.site

  zone_id = var.zone_id
  name    = each.value.name
  type    = each.value.type
  content = each.value.content
  proxied = var.proxied
  # Cloudflare sets a proxied record's TTL itself ("1" means automatic)
  ttl = var.proxied ? 1 : var.record_ttl

  lifecycle {
    precondition {
      condition     = var.serve_from != "cloudfront" || var.distribution_domain != null
      error_message = "serve_from = \"cloudfront\" needs distribution_domain, the main stack's output."
    }
  }
}

resource "cloudflare_dns_record" "vercel_extra" {
  for_each = local.vercel_extra

  zone_id = var.zone_id
  name    = each.value.name
  type    = each.value.type
  content = each.value.content
  proxied = var.proxied
  ttl     = var.proxied ? 1 : var.record_ttl

  # So these are deleted before the site records are replaced at the cutover (the CNAME made then
  # never meets an A record at its name), and made after them at a rollback
  depends_on = [cloudflare_dns_record.site]
}

resource "cloudflare_dns_record" "zone" {
  for_each = local.zone

  zone_id  = var.zone_id
  name     = each.value.name
  type     = each.value.type
  content  = each.value.type == "CAA" ? null : each.value.content
  priority = each.value.type == "MX" ? each.value.priority : null
  data     = each.value.type == "CAA" ? { flags = 0, tag = each.value.tag, value = each.value.value } : null
  proxied  = false
  ttl      = var.record_ttl
}
