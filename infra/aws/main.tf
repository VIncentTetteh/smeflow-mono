data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_route53_zone" "root" {
  name         = var.domain_name
  private_zone = false
}

data "aws_iam_policy_document" "external_secrets_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:sub"
      values   = ["system:serviceaccount:default:smeflow-api"]
    }
  }
}

data "aws_iam_policy_document" "external_secrets" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [aws_secretsmanager_secret.api.arn]
  }
}

resource "random_password" "db" {
  length  = 32
  special = true
}

resource "random_password" "redis" {
  length  = 32
  special = false
}

resource "random_password" "mq" {
  length  = 32
  special = true
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.17"

  name = local.name
  cidr = "10.40.0.0/16"

  azs             = slice(data.aws_availability_zones.available.names, 0, 2)
  private_subnets = ["10.40.0.0/19", "10.40.32.0/19"]
  public_subnets  = ["10.40.128.0/20", "10.40.144.0/20"]

  enable_nat_gateway   = true
  single_nat_gateway   = false
  enable_dns_hostnames = true
  enable_dns_support   = true
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.31"

  cluster_name    = local.name
  cluster_version = "1.31"
  subnet_ids      = module.vpc.private_subnets
  vpc_id          = module.vpc.vpc_id

  enable_irsa = true

  eks_managed_node_groups = {
    default = {
      min_size       = 3
      max_size       = 8
      desired_size   = 3
      instance_types = ["m6i.large"]
    }
  }
}

resource "aws_security_group" "data" {
  name        = "${local.name}-data"
  description = "Data services reachable from EKS private subnets"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "PostgreSQL from private subnets"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = module.vpc.private_subnets_cidr_blocks
  }

  ingress {
    description = "Redis from private subnets"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = module.vpc.private_subnets_cidr_blocks
  }

  ingress {
    description = "RabbitMQ from private subnets"
    from_port   = 5671
    to_port     = 5671
    protocol    = "tcp"
    cidr_blocks = module.vpc.private_subnets_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

module "rds" {
  source  = "terraform-aws-modules/rds/aws"
  version = "~> 6.10"

  identifier = local.name

  engine               = "postgres"
  engine_version       = "16"
  family               = "postgres16"
  major_engine_version = "16"
  instance_class       = var.environment == "production" ? "db.m7g.large" : "db.t4g.medium"

  allocated_storage     = 100
  max_allocated_storage = 500
  storage_encrypted     = true

  db_name  = "smeflow"
  username = var.db_username
  password = random_password.db.result
  port     = 5432

  multi_az               = true
  subnet_ids             = module.vpc.private_subnets
  vpc_security_group_ids = [aws_security_group.data.id]

  backup_retention_period = 35
  deletion_protection     = true
  skip_final_snapshot     = false
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${local.name}-redis"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${local.name}-redis"
  description                = "SMEflow Redis"
  engine                     = "redis"
  node_type                  = var.environment == "production" ? "cache.m7g.large" : "cache.t4g.micro"
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.data.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis.result
}

resource "aws_mq_broker" "rabbitmq" {
  broker_name        = "${local.name}-rabbitmq"
  engine_type        = "RabbitMQ"
  engine_version     = "3.13"
  host_instance_type = var.environment == "production" ? "mq.m5.large" : "mq.t3.micro"
  deployment_mode    = "CLUSTER_MULTI_AZ"
  subnet_ids         = module.vpc.private_subnets
  security_groups    = [aws_security_group.data.id]

  user {
    username = "smeflow"
    password = random_password.mq.result
  }
}

resource "aws_s3_bucket" "assets" {
  bucket = "${local.name}-assets"
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    id     = "expire-temporary-exports"
    status = "Enabled"

    filter {
      prefix = "exports/tmp/"
    }

    expiration {
      days = 7
    }
  }
}

resource "aws_secretsmanager_secret" "api" {
  name = "smeflow/${var.environment}/api"
}

resource "aws_secretsmanager_secret_version" "api" {
  secret_id = aws_secretsmanager_secret.api.id
  secret_string = jsonencode({
    APP_ENV               = var.environment
    DATABASE_URL          = "postgresql+asyncpg://${var.db_username}:${random_password.db.result}@${module.rds.db_instance_endpoint}/smeflow"
    REDIS_URL             = "rediss://:${random_password.redis.result}@${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379/0"
    RABBITMQ_URL          = "amqps://smeflow:${random_password.mq.result}@${replace(aws_mq_broker.rabbitmq.instances[0].endpoints[0], "amqps://", "")}"
    AWS_S3_BUCKET         = aws_s3_bucket.assets.bucket
    AWS_REGION            = var.aws_region
    ADMIN_ALLOWED_IPS     = join(",", var.allowed_admin_cidrs)
    TRUSTED_PROXY_COUNT   = "1"
    ENABLE_PUBLIC_DOCS    = "false"
    ENABLE_PUBLIC_METRICS = "false"
  })
}

resource "aws_iam_role" "external_secrets" {
  name               = "${local.name}-external-secrets"
  assume_role_policy = data.aws_iam_policy_document.external_secrets_assume_role.json
}

resource "aws_iam_policy" "external_secrets" {
  name   = "${local.name}-external-secrets"
  policy = data.aws_iam_policy_document.external_secrets.json
}

resource "aws_iam_role_policy_attachment" "external_secrets" {
  role       = aws_iam_role.external_secrets.name
  policy_arn = aws_iam_policy.external_secrets.arn
}

resource "aws_acm_certificate" "api" {
  domain_name       = var.api_domain_name
  validation_method = "DNS"
}

resource "aws_route53_record" "api_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = data.aws_route53_zone.root.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for record in aws_route53_record.api_validation : record.fqdn]
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/smeflow/${var.environment}/api"
  retention_in_days = 30
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name}-rds-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80

  dimensions = {
    DBInstanceIdentifier = module.rds.db_instance_identifier
  }
}
