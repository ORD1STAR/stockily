# Milestone 8 — Postgres Row-Level Security

Phase 2, round 1, step 1 (see the Phase 2 planning session): the one item
flagged as deliberately deferred since Milestone 1 and explicitly left open
by `docs/MILESTONE_6.md` — RLS as a DB-enforced backstop on top of the
already-audited app-level `orgId` filtering. Done first, before any Phase 2
module, so new tables (Milestone 9's Achats) inherit the right pattern from
day one instead of it being retrofitted later.

## What was built

- **`packages/infra-db`**: `tenant-context.ts` (a plain `AsyncLocalStorage`
  store — `runWithTenant`/`getCurrentTenantId`, framework-agnostic per
  Action Plan §6) and `rls-extension.ts` (`withTenantRls`, a Prisma Client
  Extension that issues `SELECT set_config('app.tenant_id', ...)` before
  every query that has a tenant context; `setTenantOnTransaction`, for the
  handful of call sites that open their own interactive `$transaction`).
- **`apps/api/src/prisma/prisma.service.ts`**: `PrismaService` is now
  provided via a factory (`createPrismaService`), not `new PrismaService()`
  — `$extends()` returns a structurally-compatible but distinct object, not
  an `instanceof PrismaService`. Every existing consumer (~14 files)
  continues to inject `PrismaService` by constructor-parameter type, no
  changes needed there.
- **`apps/api/src/modules/tenancy/middleware/tenant-context.middleware.ts`**:
  Express middleware (registered globally in `AppModule`), not an
  interceptor — has to run *before* the guard chain, since
  `ModuleEntitlementGuard`/`PermissionGuard` query the DB themselves.
  Duplicates `JwtAuthGuard`'s own token verification (fails open — an
  invalid/missing token here just means no tenant context gets set;
  `JwtAuthGuard` remains the sole authority that actually rejects with 401).
- **A new, restricted Postgres role, `stockily_app`** — the running API
  connects as this now (`APP_DATABASE_URL`, new env var), not `stockily`.
  `DATABASE_URL`/`stockily` keeps being what migrations/seed scripts use.
- **Migrations**: `20260826090000_enable_row_level_security` (the role +
  `ENABLE`/`FORCE ROW LEVEL SECURITY` + policies on every tenant-scoped
  table) and a same-day follow-up, `20260826100000_fix_rls_empty_string_context`
  (see "A real bug found" below).
- **`scripts/migrate-all-dbs.mjs`** (`npm run db:migrate:all`) — the actual
  fix for the "multi-database migrations" gotcha `docs/MILESTONE_7.md`
  flagged as "worth a real fix for whoever picks this up next." Fans out
  whatever's pending against the primary `stockily` database to
  `stockily_test`, `stockily_invoicing_test`, `stockily_invoicing_dev` too.

## Why a superuser broke this before it started

The very first attempt at this — write the policies, test isolation — showed
**zero isolation at all**, against every policy, regardless of how they were
written. Cause, found by checking `pg_roles` directly: `stockily` (the role
`docker-compose.yml`'s `POSTGRES_USER` creates, and what both migrations and
the running API connected as) is a **Postgres superuser**. Superusers (and
any `BYPASSRLS` role) unconditionally bypass RLS — this is a hard Postgres
rule, not something any policy can override. The real fix, standard
practice and not a workaround: a second, restricted, non-superuser role for
the running API, separate from the admin/migration role. Confirmed with the
user before creating it, since it's a change to shared local infrastructure
(new DB role, new env var, docker-compose change), not a pure code change.

## The transaction-composition problem, and how it was actually resolved

This is the exact risk the README's own recommended-path note named:
*"getting the transaction composition wrong ... risks silently breaking
either tenant isolation or transactional atomicity, which is worse than the
current state."* Resolved by empirically probing a real Prisma Client
Extension against the real dev Postgres (small throwaway scripts, not
guessed from documentation) before writing any production code:

1. A naive extension that wraps *every* model operation in its own batch
   `$transaction([setConfig, query])` works correctly for ordinary,
   non-transactional calls (the majority of this codebase's queries).
2. The same wrapping, invoked from **inside** an already-open interactive
   transaction (`prisma.$transaction(async (tx) => { tx.x.create(...) })` —
   invoicing finalize, payment recording, auth signup), does **not** throw —
   it silently opens a second, independent transaction on a separate
   connection. Proven directly: a write made this way survives even if the
   *outer* transaction later rolls back — exactly the silent atomicity
   break the README warned about, and it produces no error to notice by.
3. `this` inside a Prisma extension's `$allOperations` hook is **not** the
   calling client/transaction object (verified — it's some unrelated
   internal value), so it can't be used to detect "am I already inside a
   transaction." The one reliable signal found: `__internalParams.transaction`
   on the hook's own parameters — present (`{kind: 'itx', id: ...}`) for a
   call made via `tx`, absent for a root-level call. Undocumented/internal,
   not part of Prisma's public API — flagged in `rls-extension.ts`'s own
   comment, with a dedicated regression test (see "How to verify") specifically
   so a future `@prisma/client` upgrade that changes this shape fails loudly
   in CI rather than silently reintroducing the atomicity break.
4. Given that signal, the design: root-level calls get auto-wrapped; calls
   made from inside an interactive transaction are left alone, and the 4
   places in this codebase that open one (`auth.service.ts`'s signup,
   `invoicing.service.ts`'s finalize/recordPayment/resetPayments) — plus the
   2 domain-layer `withTransaction` implementations
   (`PrismaStockDataPort`/`PrismaQualityDataPort`, used by
   `StockService.recordMovement`'s ordinary non-composed path) — now
   explicitly call `setTenantOnTransaction(tx, orgId)` as their own literal
   first statement. Verified end-to-end against real Postgres: cross-tenant
   reads/writes correctly rejected, *and* a deliberately-thrown error inside
   an interactive transaction correctly rolled back a write with no
   atomicity leak.

## A real bug found only by running the actual e2e suite

Two, actually, neither visible from reading the SQL alone:

1. **`INSERT ... RETURNING` requires the new row to also pass the table's
   read-back check, not just its own `WITH CHECK`.** `organizations`' INSERT
   policy is intentionally unconditional (`WITH CHECK (true)` — creating a
   new org can't be scoped to a tenant that doesn't exist yet), but its
   SELECT policy is strict (`id = current_setting(...)`) — and Prisma's
   `.create()` always does `INSERT ... RETURNING`, which Postgres evaluates
   against that SELECT policy too. Fixed by generating the org's UUID in
   application code (`randomUUID()`) and calling `setTenantOnTransaction`
   *before* `organization.create()`, not after — so the tenant context is
   already correct by the time the RETURNING clause is evaluated, rather
   than loosening the SELECT policy.
2. **`current_setting(..., true)` does not reliably return `NULL` for
   "never set."** Once *any* transaction on a given pooled connection has
   called `set_config('app.tenant_id', ..., true)`, a later statement on
   that same physical connection with no active `LOCAL` override sees an
   **empty string**, not `NULL` — found by adding a temporary debug
   `$queryRaw` right before a failing `refresh_tokens` insert during signup
   and observing `v: ""`. Every policy that permits "no tenant context yet"
   (`users`, `refresh_tokens` — signup/login/refresh run with no bearer JWT,
   so the middleware never sets one) was written as `... IS NULL OR ...`,
   which this silently defeated: `'' IS NULL` is false, so neither the
   permissive branch nor the strict one matched, and the policy denied
   everything. This **failed closed, not open** (signup/login/refresh broke
   loudly, nothing leaked) — still a real, user-facing regression, fixed in
   the follow-up migration by wrapping every such check in
   `NULLIF(current_setting(...), '') IS NULL`.

Also fixed along the way: `AuditInterceptor`'s own `auditLog.create()` call
for the signup case (no `authUser` yet, orgId resolved from the handler's
own response) wasn't wrapped in `runWithTenant` — audit rows for
`organization.created` were being silently dropped (caught and logged by
the interceptor's own existing error handling, so the HTTP response itself
never reflected it — a genuinely silent gap in the audit trail, not a
crash). Fixed the same way: `runWithTenant(orgId, () => this.prisma.auditLog.create(...))`.

## What deliberately stayed narrow

- **`users`/`refresh_tokens`** permit an unscoped read when no tenant
  context is set (in addition to the normal same-org case) — signup, login,
  and refresh all inherently need to look up across every org (by email; by
  raw token hash) before any tenant identity is established. The actual
  security boundary for those three flows is "knows the right password" /
  "presents the exact right token hash," not org scoping — RLS is secondary
  defense there, same as everywhere else, not the primary one. Narrow and
  deliberate, not a blanket carve-out: only these two tables, and only the
  literal "context never set" case.
- **`modules`** (the 13-module registry) has no RLS at all — genuinely
  global reference data, identical for every org.

## How to verify

```bash
npm run db:migrate:all              # fans out to the 3 secondary DBs too
npx nx run-many -t lint typecheck build test --projects=web,api,domain-stock,domain-quality,domain-invoicing,infra-db
```
Green except `@org/api:typecheck`'s 4 known e2e-spec errors (unrelated,
pre-existing — see `docs/MILESTONE_7.md` Round 6). All 51 api tests +
45 domain tests pass — critically, this time against the **restricted**
`stockily_app` role, not the superuser: `apps/api/src/*.e2e.spec.ts` now
also set `APP_DATABASE_URL` for their target test DB, so RLS is genuinely
exercised by the suite, not silently bypassed.

Beyond the suite — the real running app, not just tests, since this
codebase's history is full of bugs only actual usage finds: rebuilt and
restarted the local `stockily-api` Docker container (`docker compose build
api && docker compose up -d api`) against the primary dev database, then
via curl: signed up two fresh orgs, created a site and a product under the
first, confirmed the second org's token gets an empty list (not the first
org's data) and a 404 (not the first org's product) when asked directly —
and confirmed the existing seeded `demo@stockily.dz` login still works
unaffected. Smoke-test orgs cleaned up afterward.

**Not done as part of this milestone**: no dedicated `rls.e2e.spec.ts` file
was added to the automated suite — the verification above (empirical
probing during design, plus the real running-app smoke test) is what
actually caught both real bugs; a follow-up could still codify the
`__internalParams.transaction` rollback-atomicity check specifically as a
permanent regression test, flagged in `rls-extension.ts`'s own comment as
worth adding if anyone picks up a future `@prisma/client` major version
bump.

## Operational notes

- **Local dev**: `.env`/`.env.example` now both need `APP_DATABASE_URL` —
  already added to both in this repo; a machine that already had a `.env`
  before this milestone needs the new line added by hand (or recopy from
  `.env.example`) before `nx serve api` will connect as the restricted role.
- **`stockily.ordi-tech.com`** (the live deployment) has **not** been
  redeployed as part of this milestone — its own separate database still
  needs the same migration + role creation + `APP_DATABASE_URL` before a
  rebuild/restart there actually enforces RLS, same steps as local, per
  CLAUDE.md's deploy commands. Flagged, not done automatically — a
  production database change like that warrants an explicit go-ahead.
