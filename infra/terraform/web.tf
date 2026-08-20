/**
 * Customer PWA on Cloud Run (standing rule R8: everything runs on GCP).
 *
 * A separate service from the API rather than one container serving both:
 * they scale on different signals, fail independently, and the API is reused
 * by the vendor, rider and admin surfaces still to come.
 */

resource "google_service_account" "web" {
  account_id   = "${local.name_prefix}-web"
  display_name = "FreshKirana customer PWA (${var.environment})"
}

/**
 * The storefront renders server-side and calls the API on every request. The
 * API is IAM-private until P8.6, so without this grant every page is a 403.
 * The web service mints an identity token from the metadata server, and this
 * binding is what makes that token accepted.
 */
resource "google_cloud_run_v2_service_iam_member" "web_invokes_api" {
  project  = var.project_id
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.web.email}"
}

/**
 * Lets the deploy workflow smoke-test the storefront after deploying it.
 *
 * The service is IAM-private, so without this the post-deploy check gets a 403
 * and cannot tell "deployed and locked down" from "deployed and broken" - the
 * same gap that made the API's first smoke test useless.
 */
resource "google_cloud_run_v2_service_iam_member" "deployer_invokes_web" {
  project  = var.project_id
  location = google_cloud_run_v2_service.web.location
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_cloud_run_v2_service" "web" {
  name     = "${local.name_prefix}-web"
  location = var.region
  labels   = local.common_labels

  deletion_protection = false

  # No allUsers binding: the storefront stays IAM-private for the same reason
  # the API does. Until P8.6 there is no real authentication behind it, so it
  # must not be publicly reachable. It opens with P8.6, not before.
  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.web.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.web_image != "" ? var.web_image : var.web_bootstrap_image

      ports {
        container_port = 3000
      }

      # Runtime configuration, not baked into the image: one image runs in any
      # environment, and repointing the API needs no rebuild.
      env {
        name  = "API_BASE"
        value = google_cloud_run_v2_service.api.uri
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      /**
       * The development sign-in.
       *
       * There is no real authentication until P8.6, so the storefront offers a
       * button that asks the API for a test customer's token. It is gated by
       * this flag rather than by NODE_ENV, because the storefront runs as a
       * production build on staging — tying it to NODE_ENV would mean either no
       * sign-in on staging or a shipped one in production.
       *
       * MUST be false, or absent, once P8.6 lands.
       */
      env {
        name  = "ALLOW_DEV_LOGIN"
        value = var.allow_dev_login ? "true" : "false"
      }

      /**
       * The Razorpay key *id*, for the checkout the browser opens (§2.10.3).
       *
       * A plain variable rather than a secret on purpose: this value is
       * published to every browser that opens a payment, so treating it as a
       * secret would be theatre. The key *secret* — the half that signs — never
       * comes near this service, which is why the storefront cannot create or
       * confirm a payment, only open one the API already made.
       *
       * Empty means no gateway here, and the pay screens say so rather than
       * opening a checkout that cannot work.
       */
      env {
        name  = "RAZORPAY_KEY_ID"
        value = var.razorpay_key_id
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        # Server components render between requests; a throttled instance makes
        # the first paint after a cold start far worse than the 1.4.2 budget.
        cpu_idle = true
      }

      # /status, not a real page. Probing a page that calls the API would mean
      # an API blip stops the storefront from *starting*, turning one outage
      # into two. Whether the process is alive is a separate question from
      # whether its data source is.
      #
      # Named /status rather than /healthz: on Cloud Run the container served
      # /healthz (this probe passed on it) while external requests to that path
      # returned a Google-generated 404. Cause not established; /status works
      # on both paths.
      startup_probe {
        http_get {
          path = "/status"
          port = 3000
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 10
      }

      liveness_probe {
        http_get {
          path = "/status"
          port = 3000
        }
        period_seconds    = 30
        failure_threshold = 3
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    # The deploy workflow sets the image; Terraform must not revert it.
    ignore_changes = [template[0].containers[0].image]
  }

  depends_on = [google_project_service.required]
}

variable "web_image" {
  description = "Container image to deploy. Empty on first apply; the deploy workflow sets it thereafter."
  type        = string
  default     = ""
}

variable "web_bootstrap_image" {
  description = <<-EOT
    Image used on the very first apply.

    Cloud Run validates that the image exists and that the revision passes its
    startup probe before creation succeeds, so this must be a real build of the
    PWA rather than a placeholder - the same lesson the API service taught on
    its first apply. Build it without local Docker:

      gcloud builds submit --region=asia-south1 --config=cloudbuild.web.yaml .
  EOT
  type        = string
  default     = "asia-south1-docker.pkg.dev/freshkirana-staging-mm/freshkirana/web:bootstrap"
}

output "web_service_name" {
  value = google_cloud_run_v2_service.web.name
}

output "web_service_url" {
  description = "IAM-private until P8.6. Reach it with `gcloud run services proxy`."
  value       = google_cloud_run_v2_service.web.uri
}
