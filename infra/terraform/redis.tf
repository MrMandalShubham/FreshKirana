/**
 * Memorystore, provisioned only when var.enable_redis is set.
 *
 * Redis is in the spec (2.3) for cache, sessions, locks, rate limits and the
 * job queue, but nothing uses it yet - the first consumer will be P3.1
 * reservations. Reaching it from Cloud Run additionally requires a Serverless
 * VPC Access connector, which carries its own hourly cost. Both stay off until
 * a part needs them, so idle staging costs roughly the price of the database.
 */

resource "google_redis_instance" "cache" {
  count = var.enable_redis ? 1 : 0

  name           = "${local.name_prefix}-redis"
  tier           = "BASIC"
  memory_size_gb = 1
  region         = var.region

  authorized_network = google_compute_network.main.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"
  redis_version      = "REDIS_7_0"

  labels = local.common_labels

  depends_on = [
    google_project_service.required,
    google_service_networking_connection.main,
  ]
}

resource "google_vpc_access_connector" "main" {
  count = var.enable_redis ? 1 : 0

  name          = "${local.name_prefix}-vpc"
  region        = var.region
  network       = google_compute_network.main.name
  ip_cidr_range = "10.8.0.0/28"
  min_instances = 2
  max_instances = 3

  depends_on = [google_project_service.required]
}
