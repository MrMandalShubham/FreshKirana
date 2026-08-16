locals {
  required_apis = [
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com",
    "servicenetworking.googleapis.com",
  ]

  redis_apis = var.enable_redis ? ["redis.googleapis.com", "vpcaccess.googleapis.com"] : []

  name_prefix = "freshkirana-${var.environment}"

  common_labels = {
    application = "freshkirana"
    environment = var.environment
    managed_by  = "terraform"
  }
}

resource "google_project_service" "required" {
  for_each = toset(concat(local.required_apis, local.redis_apis))

  project = var.project_id
  service = each.value

  # Leave APIs enabled on destroy: disabling them can break unrelated resources
  # in the same project.
  disable_on_destroy = false
}
