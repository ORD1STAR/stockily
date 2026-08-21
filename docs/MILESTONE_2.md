# Milestone 2 — Stock + Multi-Site

Implements Action Plan §7 Milestone 2: the Stock domain (products, movements,
inventory adjustments) and the Multi-Site half (sites, transfers), built
together per the plan's own note that Multi-Site can't be bolted on after
Stock ships without a painful migration. No schema changes were needed —
the Prisma schema from the original scaffold already modeled every table
this milestone touches.

## Why this milestone matters beyond itself

This milestone's real deliverable is `packages/domain-stock`'s public
service contract — every later integration (Quality's quarantine call,
Invoicing's OUT-on-finalized-line, Scan's movement-from-a-barcode) goes
through it, not through touching `stock_levels`/`stock_movements` directly.

### `@org/domain-stock` public API

```ts
class StockMovementService {
  constructor(data: StockDataPort)

  recordMovement(input: RecordMovementInput): Promise<RecordMovementResult>
  quarantine(input: QuarantineInput): Promise<QuarantineResult>
}

type StockMovementType = 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT';

interface RecordMovementInput {
  orgId: string; productId: string; siteId: string; // siteId = source for TRANSFER
  type: StockMovementType; quantity: number;         // quantity always positive
  batchId?: string | null;
  unitCost?: number | null;                          // IN only, feeds Weighted Average Cost
  toSiteId?: string | null;                          // TRANSFER only
  adjustmentDirection?: 'increase' | 'decrease';      // ADJUSTMENT only, required for it
  relatedEntityType?: string | null; relatedEntityId?: string | null; performedBy?: string | null;
}
interface RecordMovementResult {
  movementId: string; transferMovementId?: string;   // 2nd id only for TRANSFER
  fromStockLevel: StockLevelSnapshot; toStockLevel?: StockLevelSnapshot;
  events: StockDomainEvent[];
}

interface QuarantineInput {
  orgId: string; productId: string; siteId: string; quantity: number; batchId?: string | null; reason: string; performedBy?: string | null;
}
interface QuarantineResult { stockLevel: StockLevelSnapshot; events: StockDomainEvent[]; }

type StockDomainEvent =
  | { kind: 'StockMovementCreated'; orgId; siteId; productId; movementType; quantity; movementId; occurredAt }
  | { kind: 'StockQuarantined'; orgId; siteId; productId; quantity; reason; occurredAt }
  | { kind: 'StockLevelLow'; orgId; siteId; productId; quantityOnHand; minThreshold; occurredAt };

class NegativeStockError extends Error { productId; siteId; requested; available; }
class UnknownProductError extends Error { productId; }
class InsufficientQuarantineSourceError extends Error { productId; siteId; requested; available; }

function computeThresholdStatus(quantityOnHand: number, minThreshold: number | null): 'ok' | 'low' | 'out'
```

**Rules encoded here, not left to callers:**
- Negative stock is always blocked (§9 #3) — the whole movement is rejected, nothing partially applied.
- Weighted Average Cost recalculates on IN only when a `unitCost` is supplied — an IN with no known cost (e.g. a scan-triggered receipt with no invoice behind it) leaves the running average untouched rather than corrupting it with an assumed zero.
- `quarantine` does **not** create a `StockMovement` row — nothing entered/left the site, only its sellable/non-sellable classification changed (that's what `StockLevel.quantityQuarantined` is for); the `StockQuarantined` event and the caller's own `@Audit(...)` are the traceability trail instead.
- `StockLevelLow` only fires on the `ok -> (low|out)` transition, once, not on every subsequent movement while already below threshold.
- `TRANSFER` is one call, atomic, both legs (source decrement + destination increment), producing two `StockMovement` rows tied together via `relatedEntityId` — see "Transfer model" below for why status tracking is separate from this.

Concrete implementation: `packages/infra-db/src/lib/prisma-stock-data-port.ts` (`PrismaStockDataPort`, implements `StockDataPort`). **Only `StockService`** (`apps/api/src/modules/stock/stock.service.ts`) is allowed to construct `StockMovementService` — Quality/Invoicing/Sites call `StockService`'s own methods (or new ones added to it), never `@org/domain-stock` directly. `SitesService` already does this for transfers.

## What's here

**Backend** (`apps/api`)
- `StockModule`: products/categories CRUD, movement/inventory-adjustment endpoints, `GET /stock/products?siteId=<id>|all` (the wireframe's "Tous les sites" toggle), `GET /stock/products/:id` (SKU detail — `lots: null` until Quality exists), `GET/POST /stock/movements`. Every mutating route wired to `AuditInterceptor`.
- `SitesModule`: sites CRUD, transfers (`POST /sites/transfers`, `GET /sites/transfers`, `PATCH /sites/transfers/:id`) — imports `StockModule` and calls `StockService.recordMovement(..., type: 'TRANSFER')` rather than re-implementing ledger logic.
- `RealtimeModule`/`RealtimeGateway`: Socket.IO, JWT-authenticated at connect (same token as HTTP), org-room automatic, site-room via a `join-site` client message, broadcasts `StockMovementCreated`/`StockQuarantined`/`StockLevelLow`. Single-instance only (§8 #4 — no Redis adapter).
- `SiteAccessService` (new, in `TenancyModule`): resolves which sites a user can see for an `?siteId=all` request — the guard chain gates the *request*, this narrows the *rows returned* for a non-org-wide caller.

**Frontend** (`apps/web`)
- `StockPage`, `SitesPage`: real screens against the live API, following `docs/Wireframes.html`'s Stock/Multi-Sites panels (site selector incl. "Tous les sites" + Site column, status pills, SKU-detail modal, transfer list/detail) — not pixel-identical, but the same interaction shape and data.
- `AppShell`: the real sidebar (replaces the wireframe's static one), nav items enabled/disabled from `me`'s actual entitlements, not a hardcoded demo state.
- `useStockRealtime` hook: connects once per page, refetches on a `stock-event` for the org/site being viewed — proves the websocket seam works from a real browser tab, not just a server-side test.
- Demo data: `npm run db:seed:demo` (new script) seeds a demo org/user with the exact product/quantity data from `docs/Wireframes.html`, posted through the real `StockMovementService` (not raw inserts) so the seed itself exercises the domain logic.

## Decisions made here (not already pinned down by the Action Plan)

1. **Transfer model: atomic at creation, not staged.** `POST /sites/transfers` moves both ledger legs immediately; `StockTransfer.status` (`prepared → in_transit → delivered`) is a logistics/tracking status *decoupled* from the ledger, not a three-phase physical-custody state machine (which would mean stock briefly belongs to neither site while "in transit"). The real one is a bigger scope than this milestone — a future Livraisons module (Phase 2) is the natural place to refine it. Created transfers start at `in_transit` for this reason (the stock has already moved).
2. **`GET /stock/products?siteId=all` access narrowing is a service-layer concern, not a guard concern.** `SiteScopeGuard`/`PermissionGuard` treat `siteId=all` as "not a specific site to gate against" (pass through); `SiteAccessService` then filters the query to what the caller can actually see. A site-scoped-only role (e.g. Opérateur Entrepôt) still passes the guards for an all-sites request — they do have the permission somewhere — but only gets their own site(s)' rows back.
3. **Known gap, flagged not silently accepted**: `PATCH /sites/transfers/:id` isn't site-scoped by the guard chain — the route param is a transfer id, not a siteId, so `SiteScopeGuard` has nothing to match. Any user with `sites.transfer.update` can update any of the org's transfers regardless of their own site scope. Revisit if/when transfer updates need to be restricted per-site.
4. **Two new `RolePermission` actions**: `sites.transfer.read` and `sites.transfer.update` (the seed only had `sites.transfer.create`). Additive to the idempotent seed — re-running `npm run db:seed` picks them up.
5. **Fixed a real Milestone 1 friction point**: `packages/infra-db/prisma/.env` duplicating root `.env`'s `DATABASE_URL` made the Prisma CLI refuse to run (env-var conflict). Removed the duplicate file; `MILESTONE_1.md`'s quickstart updated to not recreate it.
6. **Fixed a real Milestone 1 DI gap**: `TenancyModule` provided `EntitlementCacheService` but didn't export it — harmless while `ModuleEntitlementGuard` was only ever used from within `TenancyModule` itself (Milestone 1's `MeController`), but broke the moment a different module (`StockModule`) reused the same guard via `@UseGuards`. Now exported.
7. **`PermissionGuard`/`SiteScopeGuard` now also read `siteId` from the query string**, not just params/body — needed for `GET` list endpoints. `site=all` is treated specially: `SiteScopeGuard` no-ops (nothing to gate), `PermissionGuard` checks the action against *any* of the user's roles regardless of site (see #2) — both guards' existing unit tests plus new cases cover this; no existing test's assertions changed shape.
8. **`bcryptjs` used again in `dev-seed.ts`** (dynamic import, not a hard dependency of `packages/infra-db`) — matches `AuthService`'s own choice from Milestone 1, so the demo user's password actually verifies through the real login endpoint.

## Verification performed

- `npx nx run-many -t lint build test` — clean across all 9 projects (0 errors; only pre-existing-pattern warnings: `no-non-null-assertion`/`no-explicit-any` in test helpers and the seed script, same as Milestone 1's precedent).
- `packages/domain-stock`: 15 unit tests — negative-stock rejection, Weighted Average Cost math (concrete numbers), quarantine moving quantity without touching the total, `StockLevelLow` firing exactly once on the threshold crossing (not on every subsequent movement), transfer's two-leg atomicity.
- `apps/api/src/stock.e2e.spec.ts` (new, 8 tests) — real Postgres test DB: duplicate-SKU rejection, IN updates stock level + average cost, OUT-beyond-available rejected over HTTP, transfer moves both legs, transfer status/driver update, and the site-scoped-permission suite (an Opérateur Entrepôt confined to Site A: allowed at Site A, `403 permission_denied` at Site B — not `site_scope_denied`, since `PermissionGuard`'s combined query catches it first; see that test's own comment for why — and an all-sites request narrowed to only their site).
- Manually smoke-tested the full stack against the real running server (not just tests): `npm run db:seed:demo`, then live HTTP calls confirming the seeded data matches `docs/Wireframes.html` exactly, negative-stock rejection, a real transfer moving stock between sites, and a live WebSocket client receiving a broadcast `StockMovementCreated` event within the same test run it was posted in.
- Frontend: `typecheck`/`lint`/`build` clean; the Vite dev server was confirmed serving and transforming every new file (`StockPage.tsx`, `SitesPage.tsx`, `AppShell.tsx`, `realtime.ts`, both new CSS files) without error. Full interactive browser click-through was not performed — same limitation noted in `MILESTONE_1.md`, no browser automation tool available in this session.

## How to run it

```bash
docker compose up -d
npm install
npm run prisma:migrate      # no-op if already applied — no new migration this milestone
npm run db:seed             # idempotent — re-run to pick up the 2 new sites.transfer.* actions
npm run db:seed:demo        # NEW — demo org/user/products matching docs/Wireframes.html
npx nx serve api            # http://localhost:3000/api
npx nx serve web            # http://localhost:4200
```

Log in with `demo@stockily.dz` / `Demo1234!`, or sign up a fresh org (gets the same 15-day trial as Milestone 1).

Out of scope, left for Milestone 3: no Quality module (the SKU-detail modal's "Qualité" section shows a placeholder note instead of an error), no `GET /stock/products` support for lot/batch data, no Notifications consuming `StockLevelLow` (Phase 2).
