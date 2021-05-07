terraform {
  required_version = ">= 0.14"
}

resource "google_project_service" "run_api" {
  service = "run.googleapis.com"
}

resource "google_project_service" "bq_api" {
  service = "bigquery.googleapis.com"
}

resource "google_project_service" "sm_api" {
  service = "secretmanager.googleapis.com"
}

module "event_handler_service" {
  source            = "./cloud_run_service"
  google_project_id = var.google_project_id
  google_region     = var.google_region
  service_name      = "event-handler"
  service_account   = google_service_account.cloudrun_service_account.email

  depends_on = [
    google_project_service.run_api,
  ]

}

resource "google_bigquery_dataset" "four_keys" {
  dataset_id = "four_keys"
}

# TODO: these table creation statements might not be necessary.
# When scheduled queries are implemented, try removing this.
# (see https://github.com/GoogleCloudPlatform/fourkeys/pull/90#discussion_r604320593)
resource "google_bigquery_table" "bq_table" {
  for_each   = toset(["events_raw", "changes", "deployments", "incidents"])
  dataset_id = google_bigquery_dataset.four_keys.dataset_id
  table_id   = each.key
  schema     = file("../../setup/${each.key}_schema.json")
}

resource "random_id" "event_handler_random_value" {
  byte_length = "20"
}

resource "google_secret_manager_secret" "event_handler_secret" {
  secret_id = "event_handler"
  replication {
    automatic = true
  }
  depends_on = [google_project_service.sm_api]
}

resource "google_secret_manager_secret_version" "event_handler_secret_version" {
  secret      = google_secret_manager_secret.event_handler_secret.id
  secret_data = random_id.event_handler_random_value.hex
}

resource "google_service_account" "cloudrun_service_account" {
  account_id   = "cloudrun-service-account"
  display_name = "Service Account for Cloud Run Services"
}

resource "google_secret_manager_secret_iam_member" "event_handler" {
  secret_id = google_secret_manager_secret.event_handler_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun_service_account.email}"
}

module "github_parser_service" {
  source            = "./cloud_run_service"
  google_project_id = var.google_project_id
  google_region     = var.google_region
  service_name      = "github-parser"
  service_account   = google_service_account.cloudrun_service_account.email

  depends_on = [
    google_project_service.run_api,
  ]

}