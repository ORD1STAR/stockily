# Stockily

Modular stock, quality &amp; invoicing platform. Full architecture, data model, and
decision log: [`docs/Action Plan.md`](./docs/Action%20Plan.md). Brand system,
wireframes, and pricing grid are also in `docs/`.

**All 5 Phase 1 modules are built and verified**: Auth/Tenancy, Stock +
Multi-Sites, Quality, Invoicing, and Scan — see `docs/MILESTONE_1.md`
through `docs/MILESTONE_5.md` for what was implemented and every decision
made along the way, milestone by milestone. A security-hardening pass
(CORS, rate limiting, security headers, real email capability) is done —
see `docs/MILESTONE_6.md` and "Production deployment" below. `docs/MILESTONE_7.md`
covers everything since: fixes found by actually using the app as a real
wholesaler, a fournisseurs/clients directory with a partner on every stock
movement, Scan's "Vente rapide" retail-till mode (product sale price,
paid/unpaid on the spot), flexible invoice payments (mark paid, undo a
mistaken payment), searchable client/fournisseur/product pickers, real
scannable label PDFs, an org logo (shown on invoices), and a mobile
home/Scan experience.

**Phase 2 is underway.** `docs/MILESTONE_8.md` closes the one Phase 1 gap
that had been deliberately deferred — Postgres Row-Level Security is now
enforced (see that file for why it needed a second, restricted DB role and
two real bugs it took the live app, not just tests, to find). `docs/MILESTONE_9.md`
adds Achats (Purchasing) — bons de commande, réceptions (with or without a
prior PO), and receiving reusing Stock's ledger + Quality's batch/check
flow exactly like Scan's own Entrée already does — the first Phase 2
product module, and two more real bugs the live app caught that the test
suite didn't. `docs/MILESTONE_10.md` splits that single module into two
symmetric, independently-priced ones — **Gestion Achats** (RFQ/comparaison
fournisseurs, coût de revient, facture fournisseur) and the brand-new
**Gestion Ventes** (devis → commande → facture client) — and finally wires
up stock reservations (`quantityReserved`, stubbed since Milestone 1) with
a transversal fix so every OUT/TRANSFER movement, including Vente rapide,
respects them.

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

**`npm run prisma:migrate` only migrates the one database in the root
`.env`.** Three more exist and are not kept in sync by that command:
`stockily_test` and `stockily_invoicing_test` (hardcoded connection strings at
the top of `apps/api/src/*.e2e.spec.ts`) and `stockily_invoicing_dev`. After
any schema change, also run `npm run db:migrate:all` (Milestone 8 — fans the
same migrations out to all three; a real fix for what used to be a manual
loop documented here).
Skipping this doesn't fail loudly — it surfaces later as a confusing
`PrismaClientKnownRequestError: column ... does not exist` the next time
`nx test api` runs. On Windows specifically: stop whatever's running
`nx serve api` first, or `prisma migrate dev`'s own client-regeneration
step fails with `EPERM` (the dev server holds a lock on the query engine
binary).

## Production deployment

`docker compose up -d` builds and runs all three services (Postgres, api,
web) — see `apps/api/Dockerfile`/`apps/web/Dockerfile` for how. Before
pointing this at real customer data:

1. **Set real secrets** — `JWT_SECRET` (generate with `openssl rand -hex 32`;
   `JwtConfigModule` refuses to boot without one once `NODE_ENV=production`),
   and real Postgres credentials (the compose file's `stockily`/`stockily`
   and `stockily_app`/`stockily_app` are dev-only defaults — see Milestone 8
   for what the second role is for).
2. **Set `CORS_ORIGIN`** to your actual web origin(s) (comma-separated for
   more than one) — it defaults to `http://localhost:4200`, which is correct
   for local dev but wrong for any real deployment.
3. **Set the `SMTP_*` variables** if you want invoice-overdue reminder
   emails actually sent, rather than only logged (`NoOpEmailSender`) — any
   provider's SMTP credentials work, see `.env.example`.
4. **Run migrations and seed the module/role registry** against the
   production database before first use: `npm run prisma:migrate && npm run
   db:seed` (this second one is idempotent — safe to re-run after every
   deploy that adds new permission actions). Do **not** run
   `db:seed:demo` in production — it creates a fake demo organization with
   sample data.
5. **Put a reverse proxy with TLS in front of both services** (Caddy, nginx,
   your cloud provider's load balancer, ...) — neither container terminates
   HTTPS itself. This also matters functionally, not just for security: the
   Scan module's camera access (`getUserMedia`) only works in a secure
   context (HTTPS or `localhost`) per the browsers' own APIs.
6. **`GET /health`** (outside the `/api` prefix) is a real Postgres
   round-trip check, wired into the `api` container's own Docker
   `HEALTHCHECK` already — point your orchestrator's health/readiness probe
   at it too if you're not using Compose directly (Kubernetes, ECS, ...).

**What's already hardened**: CORS allowlist (not wide-open), `helmet()`
security headers, rate limiting (5/min on signup/login/refresh, 300/min
elsewhere), a global exception filter (unexpected errors are logged
server-side and never leak raw internals to the client), every database
read/update/delete correctly scoped by `orgId` (verified by reading every
query in every service file), and — since Milestone 8 — Postgres
**Row-Level Security** as a DB-enforced backstop on top of that app-level
scoping: the running API connects as a restricted, non-superuser role
(`APP_DATABASE_URL` — a Postgres superuser/`BYPASSRLS` role, which
`DATABASE_URL`'s migration/seed role is, unconditionally bypasses RLS
regardless of policy) so that even a future missing-`orgId` bug in
application code would be caught at the database layer, not just by code
review. See `docs/MILESTONE_8.md` for the two real bugs this took the
actual running app — not just the SQL or the test suite — to find, and
exactly what it takes to safely compose with this codebase's existing
`$transaction` call sites without breaking their atomicity.

**Before pointing a *new* deployment at real customer data**: run the RLS
migration + `db:migrate:all`, and set `APP_DATABASE_URL` for that
deployment's `api` container/`nx serve api` — `docker-compose.yml`/
`.env.example` already have the pattern, but a database that predates
Milestone 8 needs the migration applied and the role created there too
before a rebuild actually enforces anything (see `docs/MILESTONE_8.md`'s
"Operational notes" — `stockily.ordi-tech.com` specifically has **not**
been redeployed with this yet).
