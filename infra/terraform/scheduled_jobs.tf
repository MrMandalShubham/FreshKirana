# ---------------------------------------------------------------------------
# Scheduled background work (spec §1.9.4).
#
# Rule R8: every delivered component has a GCP home. The SLA sweep is a
# component — without something firing it, an order a store ignores sits in
# AWAITING_VENDOR for ever and the customer is told nothing.
#
# A Cloud Run *job* rather than a timer inside the API: the service scales to
# zero, so an in-process schedule may never fire, and with several instances up
# it fires several times. A job rather than a scheduled HTTP call: Cloud
# Scheduler presents a Google identity token, not one of ours, so an HTTP
# trigger would mean a second authentication path through the guard that
# protects every other route — and one that becomes internet-reachable when
# P8.6 makes the API public.
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_job" "sla_sweep" {
  name     = "${local.name_prefix}-sla-sweep"
  location = var.region
  labels   = local.common_labels

  deletion_protection = false

  template {
    template {
      # The same identity as the API: it needs exactly the same database
      # access and nothing more.
      service_account = google_service_account.api.email
      # No retries. The next run is two minutes away and the sweep is
      # idempotent, so retrying a failed pass buys nothing a wait does not.
      max_retries = 0
      timeout     = "300s"

      containers {
        image   = var.image != "" ? var.image : var.bootstrap_image
        command = ["node"]
        args    = ["packages/api/dist/jobs/sla-sweep.js"]

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
# The identity Cloud Scheduler acts as.
#
# Separate from the API's: this one may start a job and nothing else, so a
# compromised scheduler cannot read the database or the secrets the API holds.
# ---------------------------------------------------------------------------

resource "google_service_account" "scheduler" {
  account_id   = "${local.name_prefix}-scheduler"
  display_name = "Cloud Scheduler — starts background jobs"
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_runs_sla_sweep" {
  name     = google_cloud_run_v2_job.sla_sweep.name
  location = google_cloud_run_v2_job.sla_sweep.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "sla_sweep" {
  name        = "${local.name_prefix}-sla-sweep"
  region      = var.region
  description = "Vendor acceptance SLA: reminders at 5 minutes, cancellation at 10 (§1.9.4)"

  # Every two minutes. The SLA it enforces is measured in five- and ten-minute
  # steps, so this is fine enough to be accurate and coarse enough to be cheap.
  schedule  = var.sla_sweep_schedule
  time_zone = "Asia/Kolkata"

  attempt_deadline = "320s"

  retry_config {
    # One retry. A missed pass is caught by the next one two minutes later.
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.sla_sweep.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [google_project_service.required]
}

# ---------------------------------------------------------------------------
# Reservation expiry (spec §2.5).
#
# Abandoned checkouts are the normal case, not an exception — somebody opens a
# payment app and never comes back — and each one holds stock no other customer
# can buy. §2.5 asks for a 60-second sweep.
#
# Same shape as the SLA sweep above, which is the point: the job runner was
# built once in P2.5a and this is the second tenant.
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_job" "reservation_sweep" {
  name     = "${local.name_prefix}-reservation-sweep"
  location = var.region
  labels   = local.common_labels

  deletion_protection = false

  template {
    template {
      service_account = google_service_account.api.email
      max_retries     = 0
      timeout         = "300s"

      containers {
        image   = var.image != "" ? var.image : var.bootstrap_image
        command = ["node"]
        args    = ["packages/api/dist/jobs/reservation-sweep.js"]

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
    ignore_changes = [template[0].template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_runs_reservation_sweep" {
  name     = google_cloud_run_v2_job.reservation_sweep.name
  location = google_cloud_run_v2_job.reservation_sweep.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "reservation_sweep" {
  name        = "${local.name_prefix}-reservation-sweep"
  region      = var.region
  description = "Releases stock held by checkouts nobody finished (§2.5)"

  schedule  = var.reservation_sweep_schedule
  time_zone = "Asia/Kolkata"

  attempt_deadline = "320s"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.reservation_sweep.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [google_project_service.required]
}

# ---------------------------------------------------------------------------
# Payment reconciliation (spec §2.10.3, §2.11.3).
#
# Webhooks are lost — a deploy restarts an instance mid-request, a network
# blips, a gateway has an incident. The result is an order in PENDING_PAYMENT
# while the customer's money is already gone, and nothing about it looks like an
# error from the inside. That is the worst failure this system has, and it is
# silent, so something has to go and ask.
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_job" "payment_reconciliation" {
  name     = "${local.name_prefix}-payment-reconciliation"
  location = var.region
  labels   = local.common_labels

  deletion_protection = false

  template {
    template {
      service_account = google_service_account.api.email
      max_retries     = 0
      timeout         = "300s"

      containers {
        image   = var.image != "" ? var.image : var.bootstrap_image
        command = ["node"]
        args    = ["packages/api/dist/jobs/payment-reconciliation.js"]

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
    ignore_changes = [template[0].template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_runs_payment_reconciliation" {
  name     = google_cloud_run_v2_job.payment_reconciliation.name
  location = google_cloud_run_v2_job.payment_reconciliation.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "payment_reconciliation" {
  name        = "${local.name_prefix}-payment-reconciliation"
  region      = var.region
  description = "Finds payments the webhook never reported (§2.10.3)"

  schedule  = var.payment_reconciliation_schedule
  time_zone = "Asia/Kolkata"

  attempt_deadline = "320s"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.payment_reconciliation.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [google_project_service.required]
}

# ---------------------------------------------------------------------------
# COD confirmation sweep (spec §2.10.4).
#
# The confirmation window is the whole mechanism, and a window needs something
# to close it. Without this a customer who ignores the message leaves an order
# holding stock and a delivery slot indefinitely — capacity that customers who
# *would* confirm cannot have, and a shop that never hears about either.
#
# Fourth tenant of the job runner from P2.5a.
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_job" "cod_confirmation_sweep" {
  name     = "${local.name_prefix}-cod-confirmation-sweep"
  location = var.region
  labels   = local.common_labels

  deletion_protection = false

  template {
    template {
      service_account = google_service_account.api.email
      max_retries     = 0
      timeout         = "300s"

      containers {
        image   = var.image != "" ? var.image : var.bootstrap_image
        command = ["node"]
        args    = ["packages/api/dist/jobs/cod-confirmation-sweep.js"]

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
    ignore_changes = [template[0].template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_runs_cod_confirmation_sweep" {
  name     = google_cloud_run_v2_job.cod_confirmation_sweep.name
  location = google_cloud_run_v2_job.cod_confirmation_sweep.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "cod_confirmation_sweep" {
  name        = "${local.name_prefix}-cod-confirmation-sweep"
  region      = var.region
  description = "Cancels cash orders nobody confirmed in time (§2.10.4)"

  schedule  = var.cod_confirmation_sweep_schedule
  time_zone = "Asia/Kolkata"

  attempt_deadline = "320s"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.cod_confirmation_sweep.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [google_project_service.required]
}

# ---------------------------------------------------------------------------
# Substitution sweep (spec §1.7.2).
#
# The ten-minute answer window is the whole mechanism, and a window needs
# something to close it. Without this a customer who misses the message leaves
# a picker standing in an aisle with a half-filled crate and an order that
# cannot move — and §1.7.2's fallback, refunding the line, never arrives.
#
# Fifth tenant of the job runner from P2.5a.
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_job" "substitution_sweep" {
  name     = "${local.name_prefix}-substitution-sweep"
  location = var.region
  labels   = local.common_labels

  deletion_protection = false

  template {
    template {
      service_account = google_service_account.api.email
      max_retries     = 0
      timeout         = "300s"

      containers {
        image   = var.image != "" ? var.image : var.bootstrap_image
        command = ["node"]
        args    = ["packages/api/dist/jobs/substitution-sweep.js"]

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
    ignore_changes = [template[0].template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_runs_substitution_sweep" {
  name     = google_cloud_run_v2_job.substitution_sweep.name
  location = google_cloud_run_v2_job.substitution_sweep.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "substitution_sweep" {
  name        = "${local.name_prefix}-substitution-sweep"
  region      = var.region
  description = "Refunds substitution questions nobody answered (§1.7.2)"

  schedule  = var.substitution_sweep_schedule
  time_zone = "Asia/Kolkata"

  attempt_deadline = "320s"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.substitution_sweep.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [google_project_service.required]
}

# ---------------------------------------------------------------------------
# Shelf-life sweep (spec §1.7.3).
#
# Shelf life passes with the clock rather than with anything a person does. A
# batch that was fine last night is not fine this morning, and nobody logs in to
# notice — so without this the first person to find out is a customer opening a
# bag of paneer that expires today.
#
# Daily rather than by the minute: shelf life is measured in days, and a sweep
# that runs every minute would spend a thousand queries to learn nothing.
#
# Sixth tenant of the job runner from P2.5a.
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_job" "shelf_life_sweep" {
  name     = "${local.name_prefix}-shelf-life-sweep"
  location = var.region
  labels   = local.common_labels

  deletion_protection = false

  template {
    template {
      service_account = google_service_account.api.email
      max_retries     = 0
      timeout         = "300s"

      containers {
        image   = var.image != "" ? var.image : var.bootstrap_image
        command = ["node"]
        args    = ["packages/api/dist/jobs/shelf-life-sweep.js"]

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
    ignore_changes = [template[0].template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_runs_shelf_life_sweep" {
  name     = google_cloud_run_v2_job.shelf_life_sweep.name
  location = google_cloud_run_v2_job.shelf_life_sweep.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "shelf_life_sweep" {
  name        = "${local.name_prefix}-shelf-life-sweep"
  region      = var.region
  description = "Delists stock too short-dated to deliver (§1.7.3)"

  schedule  = var.shelf_life_sweep_schedule
  time_zone = "Asia/Kolkata"

  attempt_deadline = "320s"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.shelf_life_sweep.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [google_project_service.required]
}
