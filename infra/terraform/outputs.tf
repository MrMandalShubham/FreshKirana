output "service_url" {
  description = "Cloud Run URL. IAM-private: reach it with `gcloud run services proxy`."
  value       = google_cloud_run_v2_service.api.uri
}

output "service_name" {
  value = google_cloud_run_v2_service.api.name
}

output "migrate_job_name" {
  value = google_cloud_run_v2_job.migrate.name
}

output "artifact_registry_repo" {
  description = "Image repository. Push to <region>-docker.pkg.dev/<project>/freshkirana/api:<tag>."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "sql_connection_name" {
  description = "Pass to the Cloud SQL Auth Proxy for local development."
  value       = google_sql_database_instance.main.connection_name
}

output "local_database_url" {
  description = <<-EOT
    DATABASE_URL for local development, assuming the Cloud SQL Auth Proxy is
    listening on 127.0.0.1:5432. Read it with:
      terraform output -raw local_database_url
  EOT
  value       = "postgresql://${google_sql_user.app.name}:${urlencode(random_password.db.result)}@127.0.0.1:5432/${google_sql_database.app.name}"
  sensitive   = true
}

# ---------------------------------------------------------------------------
# GitHub Actions configuration. Set these as repository variables so the deploy
# workflow can authenticate without any stored key.
# ---------------------------------------------------------------------------

output "github_workload_identity_provider" {
  description = "Set as repository variable GCP_WORKLOAD_IDENTITY_PROVIDER."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "github_deployer_service_account" {
  description = "Set as repository variable GCP_DEPLOYER_SERVICE_ACCOUNT."
  value       = google_service_account.deployer.email
}

output "redis_host" {
  description = "Null until var.enable_redis is set."
  value       = var.enable_redis ? google_redis_instance.cache[0].host : null
}

output "sla_sweep_job_name" {
  description = "Cloud Run job the scheduler executes for the §1.9.4 SLA sweep."
  value       = google_cloud_run_v2_job.sla_sweep.name
}

output "web_url" {
  description = "Customer PWA. Feed this back as var.storefront_base_url so payment recovery links point somewhere real (§2.10.3)."
  value       = google_cloud_run_v2_service.web.uri
}

output "webhook_url" {
  description = "Public front door for gateway callbacks. Register this URL plus /webhooks/razorpay in the Razorpay dashboard."
  value       = google_cloud_run_v2_service.webhooks.uri
}
