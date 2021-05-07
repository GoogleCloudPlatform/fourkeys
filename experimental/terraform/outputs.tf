output "event_handler_endpoint" {
  value = module.event_handler_service.cloud_run_endpoint
}

output "event_handler_secret" {
  value     = google_secret_manager_secret_version.event_handler_secret_version.secret_data
  sensitive = true
}