# Infrastructure — GCP (P0.5b)

Cloud Run + Cloud SQL (PostgreSQL 16 / PostGIS) in **`asia-south1` (Mumbai)**, provisioned with Terraform and deployed from GitHub Actions via Workload Identity Federation.

Mumbai keeps personal data in India, which is the simplest posture under DPDP (spec §3.6).

---

## ⚠️ Staging is private, deliberately

Until **P8.6** ships real authentication there is no way for a real user to log in — the only login is the development one. Two things follow, and neither is optional:

1. The Cloud Run service has **no `allUsers` invoker binding**. It is reachable only by identities you grant `run.invoker`. Do not make it public.
2. `node_env` stays `"development"`. The application deliberately **refuses to start** with `NODE_ENV=production` while dev auth is the only auth (see `packages/api/src/config/auth-mode.ts`).

Both revert when P8.6 lands.

---

## One-time bootstrap

Terraform manages everything except the things it needs in order to run. Do these once.

### 1. Install tooling

- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
- [Terraform](https://developer.hashicorp.com/terraform/downloads) ≥ 1.9

### 2. Create the project and enable billing

```bash
gcloud auth login
gcloud projects create freshkirana-staging --name="FreshKirana Staging"
gcloud config set project freshkirana-staging
```

Then link a billing account — in the Console, or:

```bash
gcloud billing projects link freshkirana-staging --billing-account=YOUR_BILLING_ACCOUNT_ID
```

### 3. Create the Terraform state bucket

State cannot live in the infrastructure it describes, so this one bucket is created by hand.

```bash
gcloud storage buckets create gs://freshkirana-tfstate --location=asia-south1 --uniform-bucket-level-access
```

```bash
gcloud storage buckets update gs://freshkirana-tfstate --versioning
```

Versioning matters: it is what lets you recover from a corrupted or truncated state file.

### 4. Apply

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` — set `project_id`. Then:

```bash
terraform init -backend-config="bucket=freshkirana-tfstate"
```

```bash
terraform apply
```

First apply takes ~15 minutes; Cloud SQL and the private-services connection are the slow parts.

### 5. Wire up GitHub Actions

Terraform prints what the workflow needs. Set these as **repository variables** (Settings → Secrets and variables → Actions → Variables). They are identifiers, not secrets — there is no key to store.

```bash
terraform output -raw github_workload_identity_provider   # → GCP_WORKLOAD_IDENTITY_PROVIDER
terraform output -raw github_deployer_service_account     # → GCP_DEPLOYER_SERVICE_ACCOUNT
```

Also set `GCP_PROJECT_ID` to your project id.

Until all three exist, the `deploy-staging` job skips itself — CI stays green and nothing breaks.

### 6. Seed the first image

Cloud Run needs an image before it will start. The first one is pushed by hand; every one after that comes from CI.

```bash
gcloud auth configure-docker asia-south1-docker.pkg.dev --quiet
```

```bash
docker build -t asia-south1-docker.pkg.dev/freshkirana-staging/freshkirana/api:bootstrap .
```

```bash
docker push asia-south1-docker.pkg.dev/freshkirana-staging/freshkirana/api:bootstrap
```

---

## Reaching the service

It is private, so `curl` alone returns 403. That is correct.

```bash
gcloud run services proxy freshkirana-staging-api --region=asia-south1
```

Then open `http://localhost:8080/health`.

Or with a token:

```bash
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$(gcloud run services describe freshkirana-staging-api --region=asia-south1 --format='value(status.url)')/health"
```

Grant a teammate access:

```bash
gcloud run services add-iam-policy-binding freshkirana-staging-api --region=asia-south1 --member="user:someone@example.com" --role="roles/run.invoker"
```

---

## What gets created

| Resource                          | Notes                                                                      |
| --------------------------------- | -------------------------------------------------------------------------- |
| Cloud Run service                 | Scales to **zero**; near-nil idle cost while building                      |
| Cloud Run job                     | Migrations, run to completion before a new revision serves traffic         |
| Cloud SQL PostgreSQL 16           | Private IP only, PITR on, backups retained 7 days                          |
| VPC + private services connection | So Cloud SQL has no public IP                                              |
| Artifact Registry                 | Container images                                                           |
| Secret Manager                    | `DATABASE_URL`, `JWT_SECRET` — read at runtime, never baked into the image |
| Workload Identity pool            | GitHub OIDC, scoped to this repository                                     |
| Service accounts                  | One for the app, one for deploys                                           |
| Memorystore Redis                 | **Off by default** — see below                                             |

### PostGIS

Cloud SQL ships the extension; enable it once per database when §2.8 serviceability needs it:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### Redis is off on purpose

`enable_redis = false`. Redis is in the spec (§2.3) for cache, locks, rate limits and the job queue, but nothing uses it yet — the first consumer is **P3.1 reservations**. Reaching Memorystore from Cloud Run also needs a Serverless VPC Access connector, billed hourly whether used or not. Turn both on with the part that needs them.

---

## Cost

Rough monthly idle cost for staging as configured, at the time of writing. **Check current pricing** — these are indicative, not a quote.

| Item                                       | Approx / month |
| ------------------------------------------ | -------------- |
| Cloud SQL `db-f1-micro`, zonal, 10 GB      | $8–10          |
| Cloud Run (scale to zero, low traffic)     | ~$0            |
| Artifact Registry, Secret Manager, storage | ~$1            |
| **Total**                                  | **~$10**       |

Turning on Redis adds roughly $35–45/month (Memorystore basic + VPC connector), which is why it is off.

Spec §1.3.3 targets infra under **₹400 per 1,000 orders** — track it once real traffic exists.

---

## Production

The same configuration with a different `terraform.tfvars`:

```hcl
environment            = "production"
db_tier                = "db-custom-2-4096"
db_availability_type   = "REGIONAL"   # multi-AZ, per spec §1.5
db_deletion_protection = true
min_instances          = 1            # no cold start on the order path
node_env               = "production"  # only valid once P8.6 has shipped
```

Use a separate project and a separate state prefix. Do not point production at the staging state.
