# Offline checks of the DNS stack: `tofu init -backend=false && tofu test` in infra/dns. The
# Cloudflare provider is mocked, so nothing is read from or sent to Cloudflare.

mock_provider "cloudflare" {}

variables {
  zone_id = "00000000000000000000000000000000"
}

run "vercel_dns_only" {
  command = plan

  assert {
    condition = (
      cloudflare_dns_record.site["apex"].name == "splitwit.us" && cloudflare_dns_record.site["apex"].type == "A"
      && cloudflare_dns_record.site["apex"].content == "64.29.17.65"
      && cloudflare_dns_record.site["www"].name == "www.splitwit.us" && cloudflare_dns_record.site["www"].content == "64.29.17.65"
      && alltrue([for r in cloudflare_dns_record.site : r.proxied == false && r.ttl == 300])
    )
    error_message = "The apex and www point at Vercel, DNS only, five-minute TTL."
  }

  assert {
    condition = (
      toset(keys(cloudflare_dns_record.vercel_extra)) == toset(["apex 216.198.79.65", "www 216.198.79.65"])
      && alltrue([for r in cloudflare_dns_record.vercel_extra : r.type == "A" && r.content == "216.198.79.65" && r.proxied == false])
    )
    error_message = "Vercel's second address on both names."
  }

  assert {
    condition = toset(keys(cloudflare_dns_record.zone)) == toset([
      "caa issue letsencrypt.org", "caa issue pki.goog", "caa issue sectigo.com", "caa issue amazon.com",
      "caa issuewild ;", "mx", "spf", "dmarc",
    ])
    error_message = "CAA for Vercel and Amazon with no wildcard, and the no-mail records."
  }

  assert {
    condition = (
      cloudflare_dns_record.zone["caa issue amazon.com"].data.tag == "issue"
      && cloudflare_dns_record.zone["caa issue amazon.com"].data.value == "amazon.com"
      && cloudflare_dns_record.zone["caa issue amazon.com"].data.flags == 0
      && cloudflare_dns_record.zone["caa issuewild ;"].data.value == ";"
      && cloudflare_dns_record.zone["mx"].content == "." && cloudflare_dns_record.zone["mx"].priority == 0
      && cloudflare_dns_record.zone["spf"].content == "v=spf1 -all"
      && cloudflare_dns_record.zone["dmarc"].name == "_dmarc.splitwit.us" && cloudflare_dns_record.zone["dmarc"].content == "v=DMARC1; p=reject"
      && alltrue([for r in cloudflare_dns_record.zone : r.proxied == false])
    )
    error_message = "CAA admits amazon.com; a null MX; SPF -all; DMARC reject."
  }

  assert {
    condition     = length(output.imports) == 0
    error_message = "Nothing is imported without adopt."
  }
}

# adopt = true itself can't run here (a mocked provider can't import): these check the matching,
# which adopt only switches on, and that nothing is imported without it
run "matching_records_only_are_adoptable" {
  command = plan

  variables {
    existing_records = [
      { id = "a0000000000000000000000000000001", type = "A", name = "splitwit.us", content = "64.29.17.65" },
      { id = "a0000000000000000000000000000002", type = "A", name = "splitwit.us", content = "216.198.79.65" },
      { id = "a0000000000000000000000000000003", type = "A", name = "www.splitwit.us", content = "64.29.17.65" },
      { id = "a0000000000000000000000000000004", type = "A", name = "WWW.splitwit.us.", content = "216.198.79.65" },
      { id = "c0000000000000000000000000000001", type = "CAA", name = "splitwit.us", content = "0 issue \"letsencrypt.org\"", tag = "issue", value = "letsencrypt.org" },
      { id = "c0000000000000000000000000000002", type = "CAA", name = "splitwit.us", content = "0 issue \"pki.goog\"", tag = "issue", value = "pki.goog" },
      { id = "c0000000000000000000000000000003", type = "CAA", name = "splitwit.us", content = "0 issue \"sectigo.com\"", tag = "issue", value = "sectigo.com" },
      { id = "d0000000000000000000000000000001", type = "TXT", name = "splitwit.us", content = "\"v=spf1 -all\"" },
      { id = "d0000000000000000000000000000002", type = "TXT", name = "_dmarc.splitwit.us", content = "v=DMARC1; p=reject" },
      # Neither of these is a record here: deploy.sh stops on them
      { id = "e0000000000000000000000000000001", type = "TXT", name = "splitwit.us", content = "some-verification=abc" },
      { id = "e0000000000000000000000000000002", type = "A", name = "old.splitwit.us", content = "64.29.17.65" },
    ]
  }

  assert {
    condition = tomap(output.adoptable) == tomap({
      "site/apex"                       = "a0000000000000000000000000000001"
      "vercel_extra/apex 216.198.79.65" = "a0000000000000000000000000000002"
      "site/www"                        = "a0000000000000000000000000000003"
      "vercel_extra/www 216.198.79.65"  = "a0000000000000000000000000000004"
      "zone/caa issue letsencrypt.org"  = "c0000000000000000000000000000001"
      "zone/caa issue pki.goog"         = "c0000000000000000000000000000002"
      "zone/caa issue sectigo.com"      = "c0000000000000000000000000000003"
      "zone/spf"                        = "d0000000000000000000000000000001"
      "zone/dmarc"                      = "d0000000000000000000000000000002"
    })
    error_message = "Each record in the zone that matches one here is adoptable; the rest are not."
  }

  assert {
    condition     = length(output.imports) == 0
    error_message = "Nothing is imported without adopt."
  }
}

run "a_duplicate_is_not_adoptable" {
  command = plan

  variables {
    existing_records = [
      { id = "d0000000000000000000000000000001", type = "TXT", name = "splitwit.us", content = "v=spf1 -all" },
      { id = "d0000000000000000000000000000003", type = "TXT", name = "splitwit.us", content = "\"v=spf1 -all\"" },
    ]
  }

  assert {
    condition     = length(output.adoptable) == 0
    error_message = "Two records with one signature: neither is adoptable, so deploy.sh stops on both."
  }
}

run "cloudfront" {
  command = plan

  variables {
    serve_from          = "cloudfront"
    distribution_domain = "d111111abcdef8.cloudfront.net"
  }

  assert {
    condition = (
      alltrue([for r in cloudflare_dns_record.site : r.type == "CNAME" && r.content == "d111111abcdef8.cloudfront.net" && r.proxied == false && r.ttl == 300])
      && length(cloudflare_dns_record.vercel_extra) == 0
      && contains(keys(cloudflare_dns_record.zone), "caa issue amazon.com")
    )
    error_message = "Both names are CNAMEs to the distribution, DNS only; Vercel's other address is gone."
  }
}

run "cloudfront_needs_the_distribution" {
  command = plan

  variables {
    serve_from = "cloudfront"
  }

  expect_failures = [cloudflare_dns_record.site]
}

run "proxied" {
  command = plan

  variables {
    proxied = true
  }

  assert {
    condition = (
      alltrue([for r in cloudflare_dns_record.site : r.proxied && r.ttl == 1])
      && !contains(keys(cloudflare_dns_record.zone), "caa issuewild ;")
      && contains(keys(cloudflare_dns_record.zone), "caa issue amazon.com")
    )
    error_message = "Proxied: automatic TTL, and no issuewild \";\" against Cloudflare's own authorities."
  }
}

run "vercel_retired" {
  command = plan

  variables {
    serve_from          = "cloudfront"
    distribution_domain = "d111111abcdef8.cloudfront.net"
    vercel_retired      = true
  }

  assert {
    condition     = toset([for k, r in cloudflare_dns_record.zone : k if r.type == "CAA"]) == toset(["caa issue amazon.com", "caa issuewild ;"])
    error_message = "After Vercel, CAA admits Amazon alone."
  }
}

run "acm_validation" {
  command = plan

  variables {
    acm_validation_records = [
      { domain = "splitwit.us", name = "_0123abcd.splitwit.us.", type = "CNAME", value = "_4567ef.xyz.acm-validations.aws." },
    ]
  }

  assert {
    condition = (
      cloudflare_dns_record.zone["acm _0123abcd.splitwit.us"].type == "CNAME"
      && cloudflare_dns_record.zone["acm _0123abcd.splitwit.us"].name == "_0123abcd.splitwit.us"
      && cloudflare_dns_record.zone["acm _0123abcd.splitwit.us"].content == "_4567ef.xyz.acm-validations.aws"
      && cloudflare_dns_record.zone["acm _0123abcd.splitwit.us"].proxied == false
    )
    error_message = "The certificate's validation CNAME, DNS only."
  }
}

run "zone_id_refuses_a_name" {
  command = plan

  variables {
    zone_id = "splitwit.us"
  }

  expect_failures = [var.zone_id]
}
