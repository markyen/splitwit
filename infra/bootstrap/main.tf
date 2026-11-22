# The image repository, the bucket deploy.sh uploads source to, the CodeBuild project that turns
# a source zip into an image, and the site's certificate. The build role can read that bucket's
# source and push to that one repository; nothing else.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

# The policies name their resources by ARN built from the names, rather than by the resources'
# attributes, so they render at plan time and the plan shows them in full (and tests/ can check them).
locals {
  account   = data.aws_caller_identity.current.account_id
  partition = data.aws_partition.current.partition
  project   = "splitwit-build"

  repository        = "splitwit"
  repository_arn    = "arn:${local.partition}:ecr:${var.aws_region}:${local.account}:repository/${local.repository}"
  source_bucket     = "splitwit-build-src-${local.account}"
  source_bucket_arn = "arn:${local.partition}:s3:::${local.source_bucket}"
  log_group         = "/aws/codebuild/${local.project}"
  log_group_arn     = "arn:${local.partition}:logs:${var.aws_region}:${local.account}:log-group:${local.log_group}"
}

# Tags are immutable, so a tag names one image for good and a deploy pins its digest anyway. Scan
# on push gives the basic vulnerability findings in the console.
resource "aws_ecr_repository" "app" {
  name                 = local.repository
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# The last 10 app images stay, enough to roll back a week of deploys; an untagged layer goes after
# a day.
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after a day"
        selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 1 }
        action       = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the last 10 app images"
        selection    = { tagStatus = "tagged", tagPrefixList = ["app-"], countType = "imageCountMoreThan", countNumber = 10 }
        action       = { type = "expire" }
      },
    ]
  })
}

# Lambda pulls the image with the service's own principal; this admits it for this account's
# splitwit functions only, so the deploy role needs no permission to change the repository policy.
data "aws_iam_policy_document" "ecr_lambda_pull" {
  statement {
    sid     = "LambdaPull"
    actions = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${local.partition}:lambda:${var.aws_region}:${local.account}:function:splitwit*"]
    }
  }
}

resource "aws_ecr_repository_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy     = data.aws_iam_policy_document.ecr_lambda_pull.json
}

# Source zips, one per deploy, kept a week. Versioning gives each upload a version id that the
# build is started with, so the build reads exactly the bytes deploy.sh hashed.
resource "aws_s3_bucket" "source" {
  bucket = local.source_bucket
}

resource "aws_s3_bucket_public_access_block" "source" {
  bucket                  = aws_s3_bucket.source.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "source" {
  bucket = aws_s3_bucket.source.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "source" {
  bucket = aws_s3_bucket.source.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "source" {
  bucket = aws_s3_bucket.source.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "source" {
  bucket     = aws_s3_bucket.source.id
  depends_on = [aws_s3_bucket_versioning.source]

  rule {
    id     = "expire-source"
    status = "Enabled"
    filter {}

    expiration {
      days = 7
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  # Expiring a current version leaves a delete marker; once its version is gone, so is the marker
  rule {
    id     = "remove-delete-markers"
    status = "Enabled"
    filter {}

    expiration {
      expired_object_delete_marker = true
    }
  }
}

data "aws_iam_policy_document" "source_tls" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      local.source_bucket_arn,
      "${local.source_bucket_arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "source" {
  bucket     = aws_s3_bucket.source.id
  policy     = data.aws_iam_policy_document.source_tls.json
  depends_on = [aws_s3_bucket_public_access_block.source]
}

resource "aws_cloudwatch_log_group" "build" {
  name              = local.log_group
  retention_in_days = 30
}

# CodeBuild may assume the role only for this project in this account.
data "aws_iam_policy_document" "build_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${local.partition}:codebuild:${var.aws_region}:${local.account}:project/${local.project}"]
    }
  }
}

resource "aws_iam_role" "build" {
  name                 = local.project
  description          = "CodeBuild's role for splitwit-build: read a source zip, push the image to the splitwit repository"
  assume_role_policy   = data.aws_iam_policy_document.build_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "build" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${local.log_group_arn}:*"]
  }

  statement {
    sid       = "ReadSource"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = ["${local.source_bucket_arn}/manual/*"]
  }

  # CodeBuild checks the bucket before it downloads an S3 source
  statement {
    sid       = "SourceBucket"
    actions   = ["s3:GetBucketAcl", "s3:GetBucketLocation"]
    resources = [local.source_bucket_arn]
  }

  # The registry login token has no resource of its own
  statement {
    sid       = "RegistryLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "PushImage"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [local.repository_arn]
  }
}

resource "aws_iam_role_policy" "build" {
  name   = "build-and-push"
  role   = aws_iam_role.build.id
  policy = data.aws_iam_policy_document.build.json
}

# Privileged, because docker runs inside the build. One build at a time. The source location is a
# placeholder: every build is started with --source-location-override and the upload's version id.
resource "aws_codebuild_project" "build" {
  name                   = local.project
  description            = "Builds the splitwit Lambda image from a source zip and pushes it to ECR"
  service_role           = aws_iam_role.build.arn
  build_timeout          = 20
  queued_timeout         = 30
  concurrent_build_limit = 1

  source {
    type      = "S3"
    location  = "${aws_s3_bucket.source.id}/manual/source.zip"
    buildspec = "deploy/buildspec.yml"
  }

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    type                        = "ARM_CONTAINER"
    compute_type                = "BUILD_GENERAL1_SMALL"
    image                       = "aws/codebuild/amazonlinux-aarch64-standard:3.0"
    image_pull_credentials_type = "CODEBUILD"
    privileged_mode             = true

    environment_variable {
      name  = "ECR_REPOSITORY_URL"
      value = aws_ecr_repository.app.repository_url
    }

    dynamic "environment_variable" {
      for_each = var.firebase_web_config
      content {
        name  = "NEXT_PUBLIC_FIREBASE_${environment_variable.key}"
        value = environment_variable.value
      }
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.build.name
    }
    s3_logs {
      status = "DISABLED"
    }
  }
}

# The site's certificate, for CloudFront, so in us-east-1 whatever the stack's region. It lives here
# rather than in the main stack so that its validation record can be in DNS (infra/dns) before the
# first deploy needs an issued certificate. The main stack finds it by domain once issued.
resource "aws_acm_certificate" "site" {
  region                    = "us-east-1"
  domain_name               = var.hostnames[0]
  subject_alternative_names = slice(var.hostnames, 1, length(var.hostnames))
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}
