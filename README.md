# Stockily

Modular stock, quality &amp; invoicing platform. Full architecture, data model, and
decision log: [`docs/Action Plan.md`](./docs/Action%20Plan.md). Brand system,
wireframes, and pricing grid are also in `docs/`.

This is a Phase 1 ("Fondations") skeleton: Nx monorepo, NestJS API, React
(Vite) web app, Prisma schema — structure and tooling only, no business logic
yet. See Action Plan §7 for the build sequence.

## Quickstart

```bash
docker compose up -d                 # Postgres on localhost:5432
npm install
cp .env.example packages/infra-db/prisma/.env
npm run prisma:migrate               # creates the initial migration + tables
npx nx serve api                     # http://localhost:3000/api
npx nx serve web                     # Vite dev server
```

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
- `npx nx graph` — visualize the project dependency graph
