# Stockily

Modular stock, quality &amp; invoicing platform. Full architecture, data model, and
decision log: [`docs/Action Plan.md`](./docs/Action%20Plan.md). Brand system,
wireframes, and pricing grid are also in `docs/`.

Phase 1 ("Fondations") is being built per Action Plan §7's milestone
sequence. **Milestones 1 (platform bootstrap — auth, tenancy, the guard
chain), 2 (Stock + Multi-Site), and 3 (Quality) are done** — see
[`docs/MILESTONE_1.md`](./docs/MILESTONE_1.md),
[`docs/MILESTONE_2.md`](./docs/MILESTONE_2.md), and
[`docs/MILESTONE_3.md`](./docs/MILESTONE_3.md) for what's implemented and
every decision made along the way. Invoicing and Scan have no business
logic yet.

## Quickstart

```bash
docker compose up -d                 # Postgres on localhost:5432
npm install
cp .env.example .env                 # JWT_SECRET, DATABASE_URL, etc. — one root .env only
                                      # (a second copy at packages/infra-db/prisma/.env used
                                      # to be required; Milestone 2 removed that duplicate —
                                      # the Prisma CLI reads the root one directly)
npm run prisma:migrate               # creates the initial migration + tables
npm run db:seed                      # seeds the 13-module registry + 5 system roles
npm run db:seed:demo                 # seeds wireframe-matching demo data (Milestone 2+)
npx nx serve api                     # http://localhost:3000/api
npx nx serve web                     # Vite dev server, http://localhost:4200
```

Sign up at `/signup` to try it — creates an org with a 15-day trial on all 5
Phase 1 modules and lands on a dashboard calling the real `GET /me`.

## Layout

```
apps/
  api/    NestJS backend
  web/    React (Vite) frontend
packages/
  domain-stock/ domain-quality/ domain-invoicing/ domain-tenancy/   framework-agnostic business logic
  shared-types/ shared-ui/                                          shared across apps
  infra-db/                                                          Prisma schema + repository implementations
```

`domain-*` packages must never import Nest/Express/HTTP code — enforced by
`eslint.config.mjs` (`no-restricted-imports` + `@nx/enforce-module-boundaries`),
not just convention. See Action Plan §6 for why this matters (Local-mode
readiness).

## Common commands

- `npx nx run-many -t lint` / `-t build` / `-t test` — across every project
- `npm run prisma:validate` / `prisma:generate` / `prisma:migrate`
- `npm run db:seed` — seed the module registry + system roles (idempotent)
- `npm run test:e2e:db:setup` — one-time setup of the `stockily_test`
  database that `apps/api`'s e2e test runs against (re-run after a schema
  change)
- `npx nx graph` — visualize the project dependency graph
