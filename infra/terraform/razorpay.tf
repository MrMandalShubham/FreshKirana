# ---------------------------------------------------------------------------
# Razorpay credentials (decision B3).
#
# Terraform creates the *containers* and never the values. A secret written by
# Terraform is a secret in the state file, and the state file is a thing people
# copy, back up and occasionally paste. So the versions are added out of band:
#
#   printf '%s' 'THE_KEY_SECRET' | gcloud secrets versions add \
#     freshkirana-staging-razorpay-key-secret --data-file=-
#
#   printf '%s' 'THE_WEBHOOK_SECRET' | gcloud secrets versions add \
#     freshkirana-staging-razorpay-webhook-secret --data-file=-
#
# `printf` rather than `echo` because echo appends a newline, and a webhook
# secret with a trailing newline fails every signature check while looking
# perfectly correct in the console.
#
# The key *id* is not here: it ships to browsers in the checkout SDK, so it is
# a plain variable (var.razorpay_key_id), not a secret.
# ---------------------------------------------------------------------------

resource "google_secret_manager_secret" "razorpay_key_secret" {
  secret_id = "${local.name_prefix}-razorpay-key-secret"
  labels    = local.common_labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.required]
}

# Not issued by Razorpay — chosen by us when the webhook is registered in their
# dashboard. The same string must be in both places or every delivery fails.
resource "google_secret_manager_secret" "razorpay_webhook_secret" {
  secret_id = "${local.name_prefix}-razorpay-webhook-secret"
  labels    = local.common_labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "api_razorpay_key_secret" {
  secret_id = google_secret_manager_secret.razorpay_key_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_razorpay_webhook_secret" {
  secret_id = google_secret_manager_secret.razorpay_webhook_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}
