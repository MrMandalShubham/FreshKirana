/**
 * Workload Identity Federation for GitHub Actions.
 *
 * No service-account JSON key is ever created. GitHub mints a short-lived OIDC
 * token, GCP exchanges it for credentials, and the trust is scoped to this one
 * repository - a leaked key cannot exist because there is no key.
 */

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "${local.name_prefix}-github"
  display_name              = "GitHub Actions (${var.environment})"

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Without this condition, *any* GitHub repository could exchange a token for
  # credentials in this project.
  attribute_condition = "assertion.repository == '${var.github_repository}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deployer" {
  account_id   = "${local.name_prefix}-deployer"
  display_name = "FreshKirana deployer (${var.environment})"
}

resource "google_service_account_iam_member" "deployer_workload_identity" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

locals {
  deployer_roles = [
    "roles/run.developer",           # deploy revisions and execute jobs
    "roles/artifactregistry.writer", # push images
    # Lets the post-deploy smoke test actually call the service. The service is
    # IAM-private, so without this the check gets a 403 and cannot distinguish
    # "deployed but locked down" from "deployed and broken".
    "roles/run.invoker",
    "roles/cloudbuild.builds.editor", # build images without local Docker
  ]
}

resource "google_project_iam_member" "deployer" {
  for_each = toset(local.deployer_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# A Cloud Run deploy runs *as* the service's own service account, so the
# deployer needs actAs on every service account it deploys - one per service,
# not one for the project. Missing the web one is what broke its first
# automated deploy.
resource "google_service_account_iam_member" "deployer_acts_as_api" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_acts_as_web" {
  service_account_id = google_service_account.web.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}
