output "eks_cluster_name" {
  value = module.eks.cluster_name
}

output "api_certificate_arn" {
  value = aws_acm_certificate_validation.api.certificate_arn
}

output "api_secret_name" {
  value = aws_secretsmanager_secret.api.name
}

output "external_secrets_role_arn" {
  value = aws_iam_role.external_secrets.arn
}

output "assets_bucket" {
  value = aws_s3_bucket.assets.bucket
}

output "rds_endpoint" {
  value     = module.rds.db_instance_endpoint
  sensitive = true
}

output "redis_endpoint" {
  value     = aws_elasticache_replication_group.redis.primary_endpoint_address
  sensitive = true
}
