# FreshKirana

Multi-vendor grocery marketplace for local kirana stores — planned-basket, slot-based ordering with WhatsApp-native vendor operations.

## Documentation

| Document                                                                                                             | Purpose                                                        |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [Specification](docs/FreshKirana%20%E2%80%93%20Scalable%20Grocery%20Marketplace%20Documentation%20Set.md)            | PRD, architecture, security, frontend, analytics, ops, backlog |
| [Build Plan & Workflow](docs/FreshKirana%20%E2%80%93%20Build%20Plan%20%26%20Workflow.md)                             | The 8 phases / 41 parts, confirmation gates, progress tracker  |
| [Pre-Build Readiness Checklist](docs/FreshKirana%20%E2%80%93%20Pre-Build%20Readiness%20Checklist.md)                 | Program work outside the codebase                              |
| [Gap Analysis](docs/FreshKirana%20%E2%80%93%20Documentation%20Review%2C%20Gap%20Analysis%20%26%20Recommendations.md) | Why the spec looks the way it does                             |

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
- Docker (PostgreSQL and Redis, from P0.2)

## Getting started

```bash
npm install
npm run build
npm test
```

Run the API:

```bash
npm run build
node packages/api/dist/main.js
# GET http://localhost:3000/health
```

## Scripts

| Script              | Does                        |
| ------------------- | --------------------------- |
| `npm run build`     | Builds contracts, then api  |
| `npm run typecheck` | Type-checks every workspace |
| `npm test`          | Runs all tests              |
| `npm run lint`      | ESLint                      |
| `npm run format`    | Prettier write              |
| `npm run verify`    | Everything CI runs, locally |

## Contributing

Work proceeds one **part** at a time per the Build Plan. Each part is built, verified automatically, then confirmed manually before the next begins. Commits are `type(P<part>): summary`.

Standing rules (Build Plan §I.6): analytics events ship with every feature · module boundary checks stay green · AI interfaces keep rule implementations behind them · idempotency keys on mutating endpoints · ledger stays balanced · nothing merges red · no secrets in the repo.
