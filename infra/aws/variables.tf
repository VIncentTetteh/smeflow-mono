variable "environment" {
  description = "Deployment environment, for example staging or production."
  type        = string
}

variable "aws_region" {
  description = "AWS region for SMEflow."
  type        = string
  default     = "af-south-1"
}

variable "domain_name" {
  description = "Root DNS zone name, for example smeflow.com."
  type        = string
}

variable "api_domain_name" {
  description = "API DNS name, for example api.smeflow.com."
  type        = string
}

variable "db_username" {
  description = "RDS master username."
  type        = string
  default     = "smeflow"
}

variable "allowed_admin_cidrs" {
  description = "CIDR ranges allowed to reach platform admin surfaces."
  type        = list(string)
}

variable "github_oidc_subjects" {
  description = "GitHub OIDC subjects allowed to deploy, e.g. repo:org/repo:ref:refs/heads/main."
  type        = list(string)
  default     = []
}

locals {
  name = "smeflow-${var.environment}"
  tags = {
    Application = "SMEflow"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}
