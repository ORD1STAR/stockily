# Milestone 6 — Hardening & production readiness

Per Action Plan §7 milestone 6, plus a real gap-filling pass the milestone list didn't originally call out explicitly: every Phase 1 module had at least one CRUD action with a working backend endpoint and an unused frontend client function, but no UI to actually trigger it.

## Missing CRUD, filled in

Found by auditing each page against what its own `api.ts` client function already exposed, not from a bug report:

- **Stock**: "+ Nouveau produit" (with inline new-category creation) — previously there was no way to add a product at all, only to post movements against ones that already existed.
- **Sites**: "+ Nouveau site" — no way to add a warehouse/site.
- **Invoicing**: "+ Nouveau client" (partner, NIF required) — could only select from partners that happened to exist via the demo seed.
- **Quality**: a "Résoudre" action on any row with an open non-conformity — works for both batch-based and product-direct (non-lot-tracked) non-conformities.
- **Scan**: a "Étiquettes" mode alongside "Scanner" — list/generate/print labels, the wireframe's "Impression d'étiquettes" that never got a screen.

All verified against the live database (not just build/lint): created a category+product, a site, a partner, resolved a real open non-conformity, listed labels — via curl exactly as the new UI calls them.

## Security hardening

- **CORS**: replaced wide-open `enableCors()` with an allowlist from `CORS_ORIGIN`.
- **`helmet()`**: standard security headers on every response.
- **Rate limiting** (`@nestjs/throttler`): 300/min global default, 5/min override on signup/login/refresh specifically.
- **`AllExceptionsFilter`**: typed `HttpException`s pass through unchanged; anything unexpected is logged server-side and returns a generic message, never raw internals.
- **`GET /health`**: outside the `/api` prefix, a real Postgres round-trip check, wired into the Docker `HEALTHCHECK`.
- **Real email**: `SmtpEmailSender` (nodemailer), activated by `SMTP_HOST` being set — any provider, no code change needed; `NoOpEmailSender` otherwise.

**RLS — deliberately not implemented.** Flagged since Milestone 1 as needing a dedicated spike (Prisma + pgbouncer's `SET LOCAL` interaction is a known tricky area), not a quick bolt-on under time pressure. Getting the transaction composition wrong around the app's existing `$transaction` call sites (invoice finalization, payment recording) risks silently breaking either tenant isolation or atomicity — worse than the current state. Instead: **audited every single Prisma query in every service file** for missing `orgId` scoping on reads/updates/deletes — all correctly scoped, either directly or via a preceding ownership check (one already-known gap, `SitesService.updateTransfer` not being site-scoped, was already self-documented in `MILESTONE_2.md`, not hidden). See the README's "Production deployment" section for the specific recommended implementation path for whoever picks up RLS next.

## Decisions made

1. A webpack bug (`require.resolve()` returning an internal numeric module id instead of a real path) was specifically checked for recurrence in the new Scan code, since Milestone 4 hit exactly this class of bug in the PDF service — didn't recur here, Scan's backend has no dynamic `require.resolve` pattern.
2. `AppController` gained a `PrismaService` dependency (for `/health`) — this broke the original scaffold's `app.controller.spec.ts`, which built a bare testing module with no `PrismaService` provider. Fixed with a minimal mock, not a real DB dependency in that test.
3. Docker's `HEALTHCHECK` uses `wget` (busybox), not `curl` — confirmed `wget` is actually present in `node:22-alpine` by running it in the built image, rather than assumed.
4. Two shared CSS classes (`.btn-link`) were referenced by new UI before existing in the shared stylesheet — added once, used by both Quality's resolve action and Scan's label print action.

## How to verify

```bash
docker compose up -d && npm install
npm run prisma:migrate && npm run db:seed && npm run db:seed:demo
npx nx run-many -t lint build test
npx nx serve api   # :3000/api
npx nx serve web   # :4200
```
`npx nx run-many -t lint build test` passes clean (51/51 api tests). Beyond the suite: `GET /health` returns a real DB-backed 200; `helmet()` headers present; CORS blocks an unlisted origin and allows the configured one; repeated login attempts return 429 after the configured limit; the api Docker image was rebuilt and run as a real container with a Docker `HEALTHCHECK` attached, confirmed `healthy` by Docker itself, not just by curling it externally.

## Phase 1 status

All 5 Phase 1 modules are built, merged, hardened, and have no known missing CRUD paths. The one outstanding item before this is genuinely client-ready is Postgres RLS (see above) — everything else in Action Plan §7 milestone 6's original scope is done.
