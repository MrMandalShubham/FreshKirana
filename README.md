# FreshKirana

Multi-vendor grocery marketplace for local kirana stores — planned-basket, slot-based ordering with WhatsApp-native vendor operations.

## Documentation

| Document                                                                                                                     | Purpose                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [**B2B Business Model & Operating Plan**](docs/FreshKirana%20%E2%80%93%20B2B%20Business%20Model%20%26%20Operating%20Plan.md) | **The current business model.** Supersedes the B2C marketplace model in spec §0–§1.3 |
| [Specification](docs/FreshKirana%20%E2%80%93%20Scalable%20Grocery%20Marketplace%20Documentation%20Set.md)                    | PRD, architecture, security, frontend, analytics, ops, backlog                       |
| [Build Plan & Workflow](docs/FreshKirana%20%E2%80%93%20Build%20Plan%20%26%20Workflow.md)                                     | The 8 phases / 41 parts, confirmation gates, progress tracker                        |
| [Pre-Build Readiness Checklist](docs/FreshKirana%20%E2%80%93%20Pre-Build%20Readiness%20Checklist.md)                         | Program work outside the codebase                                                    |
| [Gap Analysis](docs/FreshKirana%20%E2%80%93%20Documentation%20Review%2C%20Gap%20Analysis%20%26%20Recommendations.md)         | Why the spec looks the way it does                                                   |

## Stack

TypeScript · NestJS · PostgreSQL · Redis · Typesense · Next.js PWA — see spec §2.3.

Architecture is a **modular monolith** with enforced module boundaries (§2.1.1). Services are extracted only on the published triggers in §2.1.2, not by default.

## Layout

```
packages/
  contracts/   @freshkirana/contracts — shared domain types
  api/         @freshkirana/api — NestJS modular monolith
```

## Prerequisites

- Node.js ≥ 22 (see `.nvmrc`)
- gcloud CLI, authenticated — `gcloud auth application-default login`
- Docker Desktop — only for the local-container path below

## Getting started

**Local work runs against the staging Cloud SQL database through the Cloud SQL
Auth Proxy.** That is what `db_public_ip` exists for (`infra/terraform/variables.tf`),
and what `DATABASE_URL` in your `.env` already points at — the proxy listens on
`127.0.0.1:5432`, so the connection string looks local while the data is not.

```bash
cp .env.example .env          # then set DATABASE_URL to the staging credential
npm install
cloud-sql-proxy freshkirana-staging-mm:asia-south1:freshkirana-staging-pg --port 5432
```

Leave that running, and in a second terminal:

```bash
npm run build
npm run db:migrate
npm run verify
```

> **Nothing else may hold port 5432.** If a local Postgres container is running,
> it answers instead of the proxy and every command quietly talks to the wrong
> database — the symptom is an authentication failure, because the two have
> different passwords. Run `npm run db:down` first.

> **The suite needs a longer timeout over the proxy.** Every query makes a
> round trip to Mumbai, so the full run takes roughly half an hour against
> staging versus under a minute locally, and the slowest specs blow through
> vitest's 60-second default. Use `npx vitest run --testTimeout=240000` when
> running everything against staging. The default stays as it is because CI
> runs against a local container, where 60 seconds is generous and raising it
> would only hide a real regression.

### The local-container path

`npm run db:up` starts Postgres and Redis in Docker with the credentials in
`docker-compose.yml`, which is what CI uses. It is fine for running the suite
offline, and it is the only safe place for `npm run db:reset` — that command
destroys volumes, and it is a Docker command, so it can never reach the cloud.
Point `DATABASE_URL` at `freshkirana_local` when you use it.

Run the API:

```bash
node packages/api/dist/main.js
# GET http://localhost:3000/health
```

## Scripts

| Script                      | Does                                       |
| --------------------------- | ------------------------------------------ |
| `npm run build`             | Builds contracts, then api                 |
| `npm run typecheck`         | Type-checks every workspace                |
| `npm test`                  | Runs all tests                             |
| `npm run lint`              | ESLint                                     |
| `npm run format`            | Prettier write                             |
| `npm run verify`            | Everything CI runs, locally                |
| `npm run db:up` / `db:down` | Start / stop Postgres + Redis              |
| `npm run db:reset`          | Destroy volumes and restart clean          |
| `npm run db:generate`       | Generate a migration from schema changes   |
| `npm run db:migrate`        | Apply pending migrations                   |
| `npm run check:boundaries`  | Module boundary rules (dependency-cruiser) |
| `npm run check:schemas`     | Schema ownership per module                |

## Module boundaries

`packages/api/src/modules/` holds the 22 bounded contexts of spec §2.2. Each has the same shape:

```
<module>/
  <module>.module.ts   NestJS module
  contracts.ts         the ONLY file other modules may import from
  schema.ts            tables in this module's own PG schema — private
  internal/            everything else — private
```

Three checks enforce this in CI (spec §2.1.1, standing rule R2):

| Check                       | Catches                                              |
| --------------------------- | ---------------------------------------------------- |
| `no-cross-module-internals` | reaching past another module's `contracts.ts`        |
| `no-circular`               | circular dependencies between modules                |
| `check:schemas`             | a module touching another module's PostgreSQL schema |

These are what make the §2.1.2 extraction triggers cheap to act on later. **Do not disable one to unblock work** — fix the import instead.

> `packages/api/src/modules/order/internal/boundary-violation.example.ts.txt` is a fixture proving the rule is live. Rename it to `.ts` and `npm run check:boundaries` must fail; rename it back and it must pass.

## Contributing

Work proceeds one **part** at a time per the Build Plan. Each part is built, verified automatically, then confirmed manually before the next begins. Commits are `type(P<part>): summary`.

Standing rules (Build Plan §I.6): analytics events ship with every feature · module boundary checks stay green · AI interfaces keep rule implementations behind them · idempotency keys on mutating endpoints · ledger stays balanced · nothing merges red · no secrets in the repo.
