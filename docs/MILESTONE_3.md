# Milestone 3 — Quality

Batches/lots, quality checks, non-conformities, and the expiry sweep, per Action Plan §7 milestone 3. Builds on Milestone 2's `domain-stock` contract without modifying it.

## What was built

- **`packages/domain-quality`** — framework-agnostic (no Nest/Express/Prisma imports): `QualityService` with `createBatch`, `recordQualityCheck` (two paths — batch-based and product-direct, see below), `listNonConformities`/`resolveNonConformity`, and `runExpirySweep`.
- **`packages/infra-db`**'s `PrismaQualityDataPort` — the concrete Prisma-backed implementation, including `getBatchQuantityBySite` (see "Batch-quantity derivation" below).
- **`apps/api` QualityModule** — real controllers behind the full guard chain (`@RequiresModule('quality')`, `@RequiresPermission('quality', ...)`), audit-logged on mutations: batches, quality checks, non-conformities, expiry alerts.
- **Frontend**: the real Quality screen (lots table, SKU hover-tooltip, "+ Contrôle qualité" modal with existing-lot/new-lot/no-lot options), and Stock's SKU-detail modal now shows real lot + quality status instead of Milestone 2's placeholder.
- **Demo seed** (`packages/infra-db/prisma/dev-seed.ts`) now posts its quarantine scenarios through the real Quality flow (create batch → record check → apply `quarantineTargets` via `StockMovementService.quarantine`) instead of Milestone 2's direct-quarantine placeholder calls. One correction made along the way: the original wireframe showed the Yaourt lot as both "Conforme" and partially quarantined — a batch that passed inspection doesn't get partially quarantined, so that placeholder quantity was dropped rather than preserved for its own sake.

## The `domain-quality` public API

```ts
class QualityService {
  constructor(data: QualityDataPort)
  createBatch(input: CreateBatchInput): Promise<BatchRecord>
  listBatches(orgId, filters?: { productId? }): Promise<BatchRecord[]>
  getBatch(orgId, batchId): Promise<BatchRecord>
  recordQualityCheck(input: RecordQualityCheckInput): Promise<RecordQualityCheckResult>
  listNonConformities(orgId, status?: 'open'|'resolved'): Promise<NonConformityRecord[]>
  resolveNonConformity(orgId, id, resolutionNotes: string|null): Promise<NonConformityRecord>
  runExpirySweep(orgId?: string): Promise<ExpirySweepResult>
}

// CreateBatchInput: { orgId, productId, lotNumber, expiryDate?, quantityReceived }

// RecordQualityCheckInput — exactly one shape, not both/neither:
//   batch-based:    { orgId, productId, batchId, result, notes?, checkedBy? }
//   product-direct: { orgId, productId, siteId, quantity, result, notes?, checkedBy? }
// (product-direct exists because a quality check is NOT limited to lot-tracked
// products — an explicit correction from the user during planning: a
// non-lot-tracked product like a belt still needs an ad hoc delivery-defect
// check, and there's no batch to derive a site/quantity from, so the caller
// must state them.)

// RecordQualityCheckResult: { check, nonConformity: NonConformityRecord|null,
//   quarantineTargets: {siteId,quantity}[], events }
```

**Important design point for Scan (built next) and any other consumer**: `QualityService` does **not** call `@org/domain-stock`'s `quarantine` itself — it returns `quarantineTargets` as plain data. The caller (today, `apps/api`'s `QualityService`, which already holds the org's one `StockService`) is responsible for looping over those targets and actually calling `StockService.quarantine` for each. This was a deliberate choice, not an oversight: `domain-quality` would otherwise need a constructed `StockMovementService`, which needs a Prisma-backed `StockDataPort` — and `scope:domain` packages aren't allowed to depend on `scope:infra` (see `eslint.config.mjs`). Keeping quarantine orchestration one layer up also keeps `domain-quality` unit-testable against an in-memory port alone, with zero knowledge of Stock's internals — matching how `domain-stock` has zero knowledge of Quality.

## Batch-quantity derivation (`getBatchQuantityBySite`)

`StockLevel` only aggregates per product+site, not per batch, so "how much of batch B is on hand at site S" is reconstructed from the `stock_movements` ledger:
- IN adds, OUT subtracts — unambiguous.
- TRANSFER: both legs of a transfer share `type: 'TRANSFER'` with no field saying which leg is which. Resolved by looking up the linked `StockTransfer` row (via `relatedEntityType`/`relatedEntityId`, which `sites.service.ts`'s `createTransfer` always sets) and comparing the movement's `siteId` to that transfer's `fromSiteId`/`toSiteId`. A transfer movement with no resolvable `StockTransfer` (no current code path produces one) falls back to treating it as an outflow — a conservative, undercounting approximation, not a silent guess.
- ADJUSTMENT: `stock.service.ts`'s `createInventoryAdjustment` never attaches a `batchId`, so this case doesn't currently arise. If a future change lets an adjustment target a specific batch, this derivation (and arguably `StockMovement`'s schema — it stores only a positive `quantity`, no signed delta) will need revisiting.

## Decisions made

1. **Expiry threshold: 30 days** (`NEAR_EXPIRY_DAYS` constant), same reasoning as `AuthService`'s `TRIAL_DAYS` — a business rule, fixed for now, revisit as a per-org setting once Phase 1 has a settings surface to put it in.
2. **No separate "create non-conformity" action** — a non-conforme result opens one automatically as part of `recordQualityCheck`. The seed script only grants `quality.nonconformity.read`/`.resolve`, not `.create`, confirming this is by design.
3. **Expiry sweep is both scheduled and idempotent on demand** — safe to call from the expiry-alerts list endpoint too, so a dev/demo environment without the scheduler running still sees correct data.
4. Historical/depleted demo batches (matching the wireframe's two "Qté 0" Quality rows) are seeded with a `Batch` record but **no** matching `stock_movement` — `getBatchQuantityBySite` correctly derives 0 everywhere for these, which is exactly right for "already sold through" or "rejected entirely at receipt, never entered stock."

## How to verify

```bash
docker compose up -d && npm install
npm run prisma:migrate && npm run db:seed && npm run db:seed:demo
npx nx run-many -t lint build test
npx nx serve api   # :3000/api
npx nx serve web   # :4200
```
Log in with `demo@stockily.dz` / `Demo1234!`, open the Qualité screen. `npx nx run-many -t lint build test` passes clean (45/45 api tests) — one run showed a transient failure under heavy concurrent system load (Docker builds + a live dev-server demo running simultaneously); re-running in isolation and after clearing the Nx cache confirmed it was not a real regression.
