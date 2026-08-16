variable "project_id" {
  description = "GCP project id."
  type        = string
}

variable "region" {
  description = "Mumbai. Keeping personal data in India is the simplest posture under DPDP (spec 3.6)."
  type        = string
  default     = "asia-south1"
}

variable "environment" {
  description = "Environment name, used in resource names and labels."
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "github_repository" {
  description = "owner/repo, used to scope Workload Identity Federation so only this repository can deploy."
  type        = string
  default     = "MrMandalShubham/FreshKirana"
}

variable "db_tier" {
  description = "Cloud SQL machine type. db-f1-micro is adequate for staging; spec 1.4.1 Year-1 peak is ~150 RPS."
  type        = string
  default     = "db-f1-micro"
}

variable "db_availability_type" {
  description = "ZONAL for staging. Production uses REGIONAL for the multi-AZ requirement in spec 1.5."
  type        = string
  default     = "ZONAL"
}

variable "db_deletion_protection" {
  description = "Blocks accidental destruction. Leave true for production."
  type        = bool
  default     = false
}

variable "enable_redis" {
  description = <<-EOT
    Memorystore is provisioned only when something uses it.

    Redis is in the spec (2.3) for cache, queue, locks and rate limits, but no
    part has needed it yet - the first will be P3.1 reservations. It also
    requires a Serverless VPC Access connector to be reachable from Cloud Run,
    which roughly doubles the idle cost of this environment. Turn on with the
    part that needs it.
  EOT
  type        = bool
  default     = false
}

variable "min_instances" {
  description = "Cloud Run minimum instances. 0 lets the service scale to zero, which is why idle cost is near-nil during the build."
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Ceiling on autoscaling. Also caps the database connection count."
  type        = number
  default     = 4
}

variable "node_env" {
  description = <<-EOT
    Runtime environment for the application.

    MUST remain "development" until P8.6 ships real authentication: the
    application refuses to start with NODE_ENV=production while dev auth is the
    only auth available (see config/auth-mode.ts). The service is IAM-private
    for exactly this reason.
  EOT
  type        = string
  default     = "development"
}
