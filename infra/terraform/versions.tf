terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State lives in a GCS bucket created during bootstrap (see README).
  # Partial configuration: the bucket name is supplied by `terraform init`.
  backend "gcs" {
    prefix = "freshkirana"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
