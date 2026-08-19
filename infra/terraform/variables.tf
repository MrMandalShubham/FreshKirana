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

variable "db_edition" {
  description = <<-EOT
    Cloud SQL edition.

    Must be ENTERPRISE for shared-core tiers such as db-f1-micro and
    db-g1-small: Cloud SQL now defaults new instances to ENTERPRISE_PLUS, which
    only accepts db-perf-optimized-* tiers and costs several times more.

    ENTERPRISE_PLUS is worth revisiting for production if its read pool and
    near-zero-downtime maintenance become worth the price.
  EOT
  type        = string
  default     = "ENTERPRISE"

  validation {
    condition     = contains(["ENTERPRISE", "ENTERPRISE_PLUS"], var.db_edition)
    error_message = "db_edition must be ENTERPRISE or ENTERPRISE_PLUS."
  }
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

variable "db_public_ip" {
  description = <<-EOT
    Give the instance a public IP so developer machines can connect through the
    Cloud SQL Auth Proxy.

    This is what lets local work run against a real cloud database instead of a
    local container. It is less exposed than it sounds: no authorized networks
    are granted, so nothing can connect by IP alone - the proxy authenticates
    with IAM and encrypts with TLS, and ssl_mode below rejects anything
    unencrypted.

    Cloud Run does not use this path; it reaches the instance over the private
    IP via a unix socket. Set false for production.
  EOT
  type        = bool
  default     = true
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

variable "sla_sweep_schedule" {
  description = "Cron for the vendor acceptance SLA sweep. Every two minutes by default; the SLA it enforces is measured in five- and ten-minute steps."
  type        = string
  default     = "*/2 * * * *"
}

variable "allow_dev_login" {
  description = "Offer the development sign-in on the storefront. Must be false in production — real authentication is P8.6."
  type        = bool
  default     = true
}

variable "reservation_sweep_schedule" {
  description = "Cron for releasing expired stock holds. §2.5 asks for every 60 seconds."
  type        = string
  default     = "* * * * *"
}

variable "payment_reconciliation_schedule" {
  description = "Cron for recovering payments whose webhook never arrived. Every five minutes: fast enough that a customer is not left waiting, slow enough not to hammer the gateway."
  type        = string
  default     = "*/5 * * * *"
}

variable "razorpay_key_id" {
  description = "Razorpay key id (rzp_test_… / rzp_live_…). Public: it ships to browsers in the checkout SDK, so it is a variable rather than a secret. Empty keeps the mock provider."
  type        = string
  default     = ""
}
