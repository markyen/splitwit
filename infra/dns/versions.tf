# splitwit.us's records at Cloudflare. A stack of its own, so that a routine app deploy never holds
# a DNS credential: it is applied by hand (deploy.sh --dns), with a token limited to this one zone
# (Zone · DNS · Edit, and Zone · Zone · Read so deploy.sh can see it reaches no other).

terraform {
  required_version = ">= 1.10"

  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      # Exact: the provider handles the DNS token, so a new version is a reviewed commit
      version = "5.28.1"
    }
  }

  # Partial configuration: the bucket, key and region are passed at init time from backend.hcl
  # (see backend.hcl.example).
  backend "s3" {}
}

# The token comes from CLOUDFLARE_API_TOKEN in the environment of the one tofu process, never from
# a file in this directory.
provider "cloudflare" {}
