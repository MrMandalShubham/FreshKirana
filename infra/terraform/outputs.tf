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
  value = google_sql_database_instance.main.connection_name
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
