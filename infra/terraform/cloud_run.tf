resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "freshkirana"
  format        = "DOCKER"
  description   = "FreshKirana container images"
  labels        = local.common_labels

  docker_config {
    immutable_tags = false
  }

  depends_on = [google_project_service.required]
}

resource "google_service_account" "api" {
  account_id   = "${local.name_prefix}-api"
  display_name = "FreshKirana API (${var.environment})"
}

resource "google_project_iam_member" "api_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_database_url" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_jwt_secret" {
  secret_id = google_secret_manager_secret.jwt_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

# ---------------------------------------------------------------------------
# Migration job. Run to completion *before* a new revision serves traffic, so
# migrations must stay backward-compatible for one release (spec 2.15).
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_job" "migrate" {
  name     = "${local.name_prefix}-migrate"
  location = var.region
  labels   = local.common_labels

  deletion_protection = false

  template {
    template {
      service_account = google_service_account.api.email
      max_retries     = 1

      containers {
        image   = var.image != "" ? var.image : var.bootstrap_image
        command = ["node"]
        args    = ["packages/api/dist/db/migrate.js"]

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }
      }

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }
    }
  }

  lifecycle {
    # The deploy workflow updates the image; Terraform must not revert it.
    ignore_changes = [template[0].template[0].containers[0].image]
  }
}

# ---------------------------------------------------------------------------
# The API service.
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "api" {
  name     = "${local.name_prefix}-api"
  location = var.region
  labels   = local.common_labels

  deletion_protection = false

  # Private. No allUsers invoker binding exists, so the service is reachable
  # only by identities granted run.invoker - see the note on var.node_env:
  # until P8.6 there is no real authentication, so this must not be public.
  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.api.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image != "" ? var.image : var.bootstrap_image

      ports {
        container_port = 3000
      }

      env {
        name  = "NODE_ENV"
        value = var.node_env
      }

      /**
       * Where a payment recovery link points (§2.10.3).
       *
       * The API sends the message, so it has to know the URL to put in it — a
       * shopper cannot assemble a link from a base URL nobody sent them.
       * Configuration rather than a constant because a hardcoded host would
       * send staging customers to production, and a variable rather than the
       * web service's own `uri` because that is a dependency cycle — the
       * storefront already reads this service's URI for API_BASE.
       */
      env {
        name  = "STOREFRONT_BASE_URL"
        value = var.storefront_base_url
      }

      # PORT is deliberately absent: Cloud Run injects it automatically and
      # rejects any attempt to set it. The application already reads
      # process.env.PORT with a 3000 fallback.

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.jwt_secret.secret_id
            version = "latest"
          }
        }
      }

      # Razorpay (decision B3), mounted only once credentials exist.
      #
      # Gated rather than always-on because Cloud Run resolves secret versions
      # at deploy time: mounting a secret that has no version yet fails the
      # revision, so an empty container created ahead of the values would break
      # every deploy until somebody added them.
      #
      # With no key id the application selects the mock provider, which means
      # "cannot take real payments" rather than an outage — the catalog, the
      # basket and COD orders all keep working.
      dynamic "env" {
        for_each = var.razorpay_key_id != "" ? [1] : []
        content {
          name  = "RAZORPAY_KEY_ID"
          value = var.razorpay_key_id
        }
      }

      dynamic "env" {
        for_each = var.razorpay_key_id != "" ? [1] : []
        content {
          name = "RAZORPAY_KEY_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.razorpay_key_secret.secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.razorpay_key_id != "" ? [1] : []
        content {
          name = "RAZORPAY_WEBHOOK_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.razorpay_webhook_secret.secret_id
              version = "latest"
            }
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        # Without this the instance is throttled between requests and the
        # connection pool dies mid-idle.
        cpu_idle = true
      }

      startup_probe {
        http_get {
          path = "/health"
          port = 3000
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 6
      }

      liveness_probe {
        http_get {
          path = "/health"
          port = 3000
        }
        period_seconds    = 30
        failure_threshold = 3
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }

  depends_on = [google_project_service.required]
}

variable "image" {
  description = "Container image to deploy. Left empty on first apply; the deploy workflow sets it thereafter."
  type        = string
  default     = ""
}

variable "bootstrap_image" {
  description = <<-EOT
    Image used on the very first apply, before CI has ever deployed.

    Cloud Run validates that the image exists *and* that the revision passes its
    startup probe, so this cannot be a placeholder: a stand-in like
    gcr.io/cloudrun/hello does not serve /health and the revision never goes
    healthy. It must be a real build of this application.

    Build it without local Docker:

      gcloud builds submit --region=asia-south1 \
        --tag=asia-south1-docker.pkg.dev/PROJECT/freshkirana/api:bootstrap .

    Both Cloud Run resources ignore later changes to `image`, so this value is
    never reapplied once CI takes over.
  EOT
  type        = string
  default     = "asia-south1-docker.pkg.dev/freshkirana-staging-mm/freshkirana/api:bootstrap"
}
