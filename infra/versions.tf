terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Partial configuration: the bucket, key and region are passed at init time from backend.hcl
  # (see backend.hcl.example; deploy.sh does this).
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region
  # Tags for an inventory of the account's resources, from the gitignored terraform.tfvars.json
  default_tags {
    tags = var.audit_tags
  }
}
