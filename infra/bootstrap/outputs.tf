# deploy.sh reads these with `tofu output -json` in this directory.

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "source_bucket" {
  value = aws_s3_bucket.source.id
}

output "codebuild_project" {
  value = aws_codebuild_project.build.name
}

output "build_role_arn" {
  value = aws_iam_role.build.arn
}

output "certificate_arn" {
  value = aws_acm_certificate.site.arn
}

# The CNAMEs that prove control of each name to ACM; infra/dns creates them. Public DNS data.
output "acm_validation_records" {
  value = [
    for option in aws_acm_certificate.site.domain_validation_options : {
      domain = option.domain_name
      name   = option.resource_record_name
      type   = option.resource_record_type
      value  = option.resource_record_value
    }
  ]
}
