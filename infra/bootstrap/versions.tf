# The build pipeline: applied once, by hand, before the first deploy (see ../../README.md). The main
# stack in infra/ reads nothing from this state; deploy.sh takes the names from its outputs.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Partial configuration: the bucket, key and region are passed at init time from backend.hcl
  # (see backend.hcl.example).
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region
  # Tags for an inventory of the account's resources, from the gitignored terraform.tfvars.json
  default_tags {
    tags = var.audit_tags
  }
}
