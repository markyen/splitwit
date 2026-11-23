# Offline checks of the bootstrap stack: `tofu init -backend=false && tofu test` in infra/bootstrap.
# The provider runs with placeholder credentials and makes no AWS call: the caller identity is
# overridden, and the policy documents, which name their resources by ARNs built from names,
# render for real at plan time.

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "placeholder"
  secret_key                  = "placeholder"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
}

variables {
  audit_tags = { "inventory:project" = "splitwit" }
  firebase_web_config = {
    API_KEY             = "test-key"
    AUTH_DOMAIN         = "test.firebaseapp.com"
    PROJECT_ID          = "test"
    STORAGE_BUCKET      = "test.appspot.com"
    MESSAGING_SENDER_ID = "100"
    APP_ID              = "1:100:web:abc"
  }
}

override_data {
  target = data.aws_caller_identity.current
  values = { account_id = "000000000000" }
}

run "build_role_is_least_privilege" {
  command = plan

  assert {
    condition = toset(flatten([for s in jsondecode(data.aws_iam_policy_document.build.json).Statement : s.Action])) == toset([
      "logs:CreateLogStream", "logs:PutLogEvents",
      "s3:GetObject", "s3:GetObjectVersion", "s3:GetBucketAcl", "s3:GetBucketLocation",
      "ecr:GetAuthorizationToken",
      "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart",
    ])
    error_message = "The build role's actions changed; review them."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(data.aws_iam_policy_document.build.json).Statement :
      s.Effect == "Allow" && !can(regex("\\*", join(",", flatten([s.Action]))))
    ])
    error_message = "No wildcard action in the build role."
  }

  # "*" only for the registry login, which has no resource
  assert {
    condition = alltrue([
      for s in jsondecode(data.aws_iam_policy_document.build.json).Statement :
      s.Sid == "RegistryLogin" || !contains(flatten([s.Resource]), "*")
    ])
    error_message = "Only RegistryLogin may use Resource \"*\"."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(data.aws_iam_policy_document.build.json).Statement :
      s.Sid != "PushImage" || flatten([s.Resource]) == ["arn:aws:ecr:us-east-1:000000000000:repository/splitwit"]
    ])
    error_message = "Pushes go to the splitwit repository only."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(data.aws_iam_policy_document.build.json).Statement :
      s.Sid != "ReadSource" || flatten([s.Resource]) == ["arn:aws:s3:::splitwit-build-src-000000000000/manual/*"]
    ])
    error_message = "The build reads the manual/ source prefix only."
  }
}

run "build_trust_is_this_project_only" {
  command = plan

  assert {
    condition     = jsondecode(data.aws_iam_policy_document.build_trust.json).Statement[0].Principal.Service == "codebuild.amazonaws.com"
    error_message = "Only CodeBuild may assume the build role."
  }

  assert {
    condition = (
      jsondecode(data.aws_iam_policy_document.build_trust.json).Statement[0].Condition.ArnLike["aws:SourceArn"] == "arn:aws:codebuild:us-east-1:000000000000:project/splitwit-build"
      && jsondecode(data.aws_iam_policy_document.build_trust.json).Statement[0].Condition.StringEquals["aws:SourceAccount"] == "000000000000"
    )
    error_message = "The trust is pinned to this account's splitwit-build project."
  }
}

run "repository_and_bucket" {
  command = plan

  assert {
    condition     = aws_ecr_repository.app.image_tag_mutability == "IMMUTABLE" && aws_ecr_repository.app.image_scanning_configuration[0].scan_on_push
    error_message = "Tags are immutable and images are scanned on push."
  }

  assert {
    condition = (
      jsondecode(data.aws_iam_policy_document.ecr_lambda_pull.json).Statement[0].Principal.Service == "lambda.amazonaws.com"
      && toset(jsondecode(data.aws_iam_policy_document.ecr_lambda_pull.json).Statement[0].Action) == toset(["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"])
      && jsondecode(data.aws_iam_policy_document.ecr_lambda_pull.json).Statement[0].Condition.ArnLike["aws:SourceArn"] == "arn:aws:lambda:us-east-1:000000000000:function:splitwit*"
    )
    error_message = "The repository admits Lambda pulls for this account's splitwit functions only."
  }

  assert {
    condition = (
      aws_s3_bucket_public_access_block.source.block_public_acls && aws_s3_bucket_public_access_block.source.block_public_policy
      && aws_s3_bucket_public_access_block.source.ignore_public_acls && aws_s3_bucket_public_access_block.source.restrict_public_buckets
    )
    error_message = "The source bucket blocks all public access."
  }

  assert {
    condition = (
      jsondecode(data.aws_iam_policy_document.source_tls.json).Statement[0].Effect == "Deny"
      && jsondecode(data.aws_iam_policy_document.source_tls.json).Statement[0].Condition.Bool["aws:SecureTransport"] == "false"
    )
    error_message = "The source bucket refuses plain http."
  }

  assert {
    condition     = aws_s3_bucket_versioning.source.versioning_configuration[0].status == "Enabled"
    error_message = "Versioning gives each upload the version id the build starts from."
  }
}

run "codebuild_environment" {
  command = plan

  assert {
    condition = (
      aws_codebuild_project.build.environment[0].type == "ARM_CONTAINER"
      && aws_codebuild_project.build.environment[0].privileged_mode
      && aws_codebuild_project.build.concurrent_build_limit == 1
      && aws_codebuild_project.build.source[0].buildspec == "deploy/buildspec.yml"
    )
    error_message = "One privileged arm64 build at a time, from deploy/buildspec.yml."
  }

  assert {
    condition = toset([for v in aws_codebuild_project.build.environment[0].environment_variable : v.name]) == toset([
      "ECR_REPOSITORY_URL",
      "NEXT_PUBLIC_FIREBASE_API_KEY", "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "NEXT_PUBLIC_FIREBASE_APP_ID",
    ])
    error_message = "The build's environment is the repository URL and the six Firebase values, nothing else."
  }

  assert {
    condition     = alltrue([for v in aws_codebuild_project.build.environment[0].environment_variable : v.type == "PLAINTEXT"])
    error_message = "Only public values belong in the build's environment."
  }
}

run "firebase_config_needs_all_six_keys" {
  command = plan

  variables {
    firebase_web_config = {
      API_KEY    = "test-key"
      PROJECT_ID = "test"
    }
  }

  expect_failures = [var.firebase_web_config]
}

run "firebase_config_refuses_quotes" {
  command = plan

  variables {
    firebase_web_config = {
      API_KEY             = "x\" && curl evil"
      AUTH_DOMAIN         = "test.firebaseapp.com"
      PROJECT_ID          = "test"
      STORAGE_BUCKET      = "test.appspot.com"
      MESSAGING_SENDER_ID = "100"
      APP_ID              = "1:100:web:abc"
    }
  }

  expect_failures = [var.firebase_web_config]
}

run "certificate_and_lifecycle" {
  command = plan

  assert {
    condition = (
      aws_acm_certificate.site.region == "us-east-1"
      && aws_acm_certificate.site.domain_name == "splitwit.us"
      && toset(aws_acm_certificate.site.subject_alternative_names) == toset(["splitwit.us", "www.splitwit.us"])
      && aws_acm_certificate.site.validation_method == "DNS"
    )
    error_message = "One DNS-validated certificate in us-east-1 for the apex and www."
  }

  assert {
    condition = (
      length(aws_s3_bucket_lifecycle_configuration.source.rule) == 2
      && anytrue([for r in aws_s3_bucket_lifecycle_configuration.source.rule : try(r.expiration[0].expired_object_delete_marker, false)])
    )
    error_message = "Expired delete markers are removed."
  }
}

run "hostnames_must_be_apex_then_www" {
  command = plan

  variables {
    hostnames = ["splitwit.us", "app.splitwit.us"]
  }

  expect_failures = [var.hostnames]
}

run "no_permissions_boundary_by_default" {
  command = plan

  assert {
    condition     = aws_iam_role.build.permissions_boundary == null
    error_message = "Without permissions_boundary_arn, the build role has no permissions boundary."
  }
}

run "permissions_boundary_on_the_build_role" {
  command = plan

  variables {
    permissions_boundary_arn = "arn:aws:iam::000000000000:policy/example-boundary"
  }

  assert {
    condition     = aws_iam_role.build.permissions_boundary == "arn:aws:iam::000000000000:policy/example-boundary"
    error_message = "With permissions_boundary_arn set, splitwit-build carries it."
  }
}

run "permissions_boundary_refuses_a_role_arn" {
  command = plan

  variables {
    permissions_boundary_arn = "arn:aws:iam::000000000000:role/splitwit-build"
  }

  expect_failures = [var.permissions_boundary_arn]
}
