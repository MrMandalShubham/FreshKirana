resource "random_password" "db" {
  length  = 32
  special = true
  # Excluded because the password is embedded in a URL connection string.
  override_special = "-_.~"
}

resource "google_sql_database_instance" "main" {
  name             = "${local.name_prefix}-pg"
  database_version = "POSTGRES_16"
  region           = var.region

  deletion_protection = var.db_deletion_protection

  settings {
    tier = var.db_tier
    # Explicit: new instances default to ENTERPRISE_PLUS, which rejects
    # shared-core tiers like db-f1-micro outright.
    edition           = var.db_edition
    availability_type = var.db_availability_type
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true

    backup_configuration {
      enabled = true
      # Point-in-time recovery. Spec 1.4.2 requires RPO <= 5 minutes; without
      # this, recovery is limited to the last nightly backup.
      point_in_time_recovery_enabled = true
      start_time                     = "18:30" # 00:00 IST
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      day          = 7  # Sunday
      hour         = 20 # 01:30 IST Monday - outside the 07-10 and 18-21 grocery peaks (1.4.1)
      update_track = "stable"
    }

    ip_configuration {
      # Cloud Run always reaches the instance over the *private* IP, using the
      # built-in Cloud SQL connector via a unix socket.
      #
      # The public IP exists only so developer machines can connect through the
      # Cloud SQL Auth Proxy. Crucially, `authorized_networks` is left empty:
      # nothing can connect by IP address alone. The proxy authenticates with
      # IAM, so access is granted per-identity and revoked centrally.
      ipv4_enabled    = var.db_public_ip
      private_network = google_compute_network.main.id

      # Reject any unencrypted connection. Both paths - proxy and unix socket -
      # are encrypted, so this costs nothing and closes the plaintext door that
      # a public IP would otherwise leave ajar.
      ssl_mode = "ENCRYPTED_ONLY"
    }

    database_flags {
      name  = "max_connections"
      value = "100"
    }

    insights_config {
      query_insights_enabled  = true
      record_application_tags = true
    }

    user_labels = local.common_labels
  }

  depends_on = [
    google_project_service.required,
    google_service_networking_connection.main,
  ]
}

resource "google_sql_database" "app" {
  name     = "freshkirana"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "app" {
  name     = "freshkirana"
  instance = google_sql_database_instance.main.name
  password = random_password.db.result
}

# ---------------------------------------------------------------------------
# Private networking for Cloud SQL.
# ---------------------------------------------------------------------------

resource "google_compute_network" "main" {
  name                    = "${local.name_prefix}-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.required]
}

resource "google_compute_global_address" "private_ip" {
  name          = "${local.name_prefix}-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "main" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip.name]

  depends_on = [google_project_service.required]
}

# ---------------------------------------------------------------------------
# Secrets. Never rendered into environment variables in Terraform state
# consumers - Cloud Run reads them at runtime from Secret Manager.
# ---------------------------------------------------------------------------

resource "google_secret_manager_secret" "database_url" {
  secret_id = "${local.name_prefix}-database-url"
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

resource "google_secret_manager_secret_version" "database_url" {
  secret = google_secret_manager_secret.database_url.id

  # Unix-socket form: Cloud Run mounts the Cloud SQL connector at
  # /cloudsql/<connection name>, so no VPC connector and no public IP.
  secret_data = "postgresql://${google_sql_user.app.name}:${urlencode(random_password.db.result)}@/${google_sql_database.app.name}?host=/cloudsql/${google_sql_database_instance.main.connection_name}"
}

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "google_secret_manager_secret" "jwt_secret" {
  secret_id = "${local.name_prefix}-jwt-secret"
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

resource "google_secret_manager_secret_version" "jwt_secret" {
  secret      = google_secret_manager_secret.jwt_secret.id
  secret_data = random_password.jwt_secret.result
}
