# ---------------------------------------------------------------------------
# The public webhook front door (spec §2.10.2, §2.12).
#
# Cloud Run's IAM is per **service**, not per route. The API is private and
# stays that way until P8.6 ships real authentication — but Razorpay and the
# WhatsApp BSP are anonymous callers on the internet who must reach exactly two
# endpoints. There is no way to express that on a single service.
#
# So this is the same image with a different entry point: same code, same
# deploy, same database, and an application-level allowlist that answers
# nothing else. See packages/api/src/webhook-main.ts, and the test beside it
# that asserts every customer, cart and admin route returns 404 here.
#
# What protects it is the signature on the request body. That is how every
# payment webhook on the internet works.
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "webhooks" {
  name     = "${local.name_prefix}-webhooks"
  location = var.region
  labels   = local.common_labels

  deletion_protection = false

  # Public by necessity — see the header. The allowlist and the signature are
  # the controls; IAM cannot be one here.
  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.api.email

    # Webhooks are bursty and rare. Scaling to zero means this costs nothing
    # while no gateway is calling, at the price of a cold start on the first
    # one — which the gateway's own retry covers.
    scaling {
      min_instance_count = 0
      max_instance_count = 4
    }

    containers {
      image   = var.image != "" ? var.image : var.bootstrap_image
      command = ["node"]
      args    = ["packages/api/dist/webhook-main.js"]

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
        name  = "NODE_ENV"
        value = var.node_env
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
      }

      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 10
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }
  }

  lifecycle {
    # The deploy workflow updates the image; Terraform must not revert it.
    ignore_changes = [template[0].containers[0].image]
  }
}

# The one place in this configuration that grants anonymous access. Deliberate,
# narrow, and paired with the test that keeps the service narrow.
resource "google_cloud_run_v2_service_iam_member" "webhooks_public" {
  name     = google_cloud_run_v2_service.webhooks.name
  location = google_cloud_run_v2_service.webhooks.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "webhook_service_url" {
  description = "Register this in the Razorpay dashboard as POST {url}/webhooks/razorpay"
  value       = google_cloud_run_v2_service.webhooks.uri
}
