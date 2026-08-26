# Milestone 9 — Achats (Purchasing)

Phase 2, round 1, step 2 (see the Phase 2 planning session, `docs/MILESTONE_8.md`
for step 1): the first Phase 2 product module, built on top of Milestone 8's
RLS so its new tables inherit the right tenant-isolation pattern from day
one rather than needing it retrofitted. Achats was already seeded into the
`Module` registry since Milestone 1 (`phase: 2, dependencies: ['stock']`) —
this milestone is what actually builds it.

## What was built

- **Schema** (4 new tables + 1 counter, `purchase_orders`/
  `purchase_order_lines`/`purchase_receipts`/`purchase_receipt_lines`/
  `purchase_order_counters`): the same proven "header + lines" pattern as
  `Invoice`/`InvoiceLine`. `PurchaseOrder.number` uses the exact same atomic
  `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` counter mechanism as
  invoice numbering (`InvoiceCounter`) — reused for pattern consistency,
  not because a legal gapless requirement applies here the way Décret
  05-468 does to sales invoices. `Invoice.purchaseOrderId` is a new
  nullable FK linking a `SUPPLIER` invoice to the PO it's settling, purely
  for traceability (Action Plan §5: additive, nothing conditioned on it).
  `PurchaseReceipt.purchaseOrderId`
  and `PurchaseReceiptLine.purchaseOrderLineId` are both nullable —
  "réception libre" (receiving with no prior PO at all) is a first-class
  path, not a special case, for the smaller/informal-supplier case.
- **`apps/api` PurchasingModule** — no `@org/domain-purchasing` package:
  unlike Stock/Quality/Invoicing, there's no framework-agnostic business
  rule here that domain-stock/domain-quality don't already own. Receiving
  reuses `StockService.recordMovement` (IN) and, optionally per line,
  `QualityService.createBatch`/`recordQualityCheck` — exactly the same
  three-call sequence Scan's own new-lot Entrée flow already uses
  (`docs/MILESTONE_5.md`), including posting the stock movement *before*
  the quality check (Milestone 7 Round 1's fix, reused deliberately: doing
  it in the other order made the quarantine calculation read the ledger
  before the receipt's own units existed on it).
- **Frontend `PurchasingPage`** — PO list with status/progression, a
  create-PO modal (supplier via the existing `SearchableSelect`, multi-line
  items), a detail modal, and a receiving modal shared between "receive
  against this PO" (pre-filled, remaining-quantity-aware) and "réception
  libre" (free-form product picker, no PO). `apps/web/src/lib/modules.ts`'s
  `PHASE1_MODULES` renamed to `PRODUCT_MODULES` — it's no longer just
  Phase 1 now that Achats is in it.
- **Permissions**: `purchasing.order.{create,read,update,cancel}`,
  `purchasing.receipt.{create,read}` added to `seed.ts`'s `ACTIONS` map —
  Gestionnaire/Super Admin get everything, Opérateur Entrepôt gets
  order-read + receipt-create/read, Commercial/Comptable get order-read
  only.

## Two real bugs found only by actually clicking through it in Chrome

Backend build/lint/typecheck/tests were clean throughout — neither of these
surfaced until the real deployed app was driven end-to-end from a browser,
exactly the pattern CLAUDE.md's own history keeps repeating:

1. **`unitCost.toFixed is not a function`** — Prisma serializes `Decimal`
   fields (`quantityOrdered`/`quantityReceived`/`unitCost`) as **strings**
   over JSON (`Decimal.js`'s own `toJSON`, to avoid float precision loss),
   not numbers. `StockService`/`InvoicingService` already established the
   fix — convert with `Number(...)` at the service boundary before
   returning — but `PurchasingService` was written returning raw Prisma
   results directly, so every quantity/cost field silently arrived at the
   frontend as a string. Crashed the order-detail modal's `.toFixed(2)`
   call the moment it was opened for real. Fixed with `serializeOrder`/
   `serializeReceipt` helpers applied at every return point — the same
   fix-once-at-the-boundary shape as the existing services, not a
   frontend-side coercion band-aid.
2. **A purchase order's product column showed a raw UUID instead of "SKU —
   Nom"** — `listPurchaseOrders`'s Prisma `include` had `lines: true`
   without `product: true`, while `getPurchaseOrder`'s did include it. The
   frontend's order-detail modal is fed straight from whichever row was
   clicked in the list (no separate fetch on open), so it needed the exact
   same shape both endpoints return — found by actually opening a real
   order's detail after creating it through the UI, not by reading either
   endpoint's code in isolation.

Both required a `docker compose build --no-cache api` + container restart
per fix — this environment's Docker BuildKit cache silently served a stale
layer on at least one earlier rebuild in this same session (verified by
`grep`-ing the running container's actual bundled `main.js` for the
expected new code and finding it absent even after a rebuild reported
success) — worth remembering for whoever next debugs "I fixed it, why is
the container still doing the old thing."

## Verification

```bash
npx nx run-many -t lint typecheck build test --projects=web,api,domain-stock,domain-quality,domain-invoicing,infra-db
```
Green except `@org/api:typecheck`'s 4 known e2e-spec errors (unrelated,
pre-existing — `docs/MILESTONE_7.md` Round 6). 51 api tests + 45 domain
tests pass.

Beyond the suite — the real running app, twice over:

- **curl, against a fresh signed-up org** (entitlement granted directly via
  SQL — no module-activation UI exists yet for any module, Phase 1 or 2,
  per Milestone 6's own still-open item): created a PO, partially received
  it with a new lot + a `conforme` quality check (confirmed `quantityOnHand`
  and `averageCost` updated correctly on `stock/products`), then a second
  org's *free* receipt (no PO) with a `non_conforme` check — confirmed the
  received quantity landed entirely in `quantityQuarantined`, none in
  `quantityOnHand`, exactly like Quality's existing non-lot-tracked
  quarantine path.
- **Real Chrome, against `stockily.ordi-tech.com`** (the local browser
  automation tool in this environment can reach the public internet but
  not this machine's own `localhost` — confirmed by testing against
  `example.com` successfully first — so this *is* the same
  `docker-compose.yml` containers as local, per CLAUDE.md, just reached
  through the public front door instead of assuming a separate deploy step
  was needed): logged in as the seeded demo org, added a real supplier
  partner, created a PO through the actual form, opened its detail (this
  is what caught bug #1), receptioned it partially with a new lot + a
  conforme check through the actual receiving modal (this is what caught
  bug #2 once the detail modal stopped crashing), and confirmed the
  order's status/progression updated to "Partiellement reçu — 12 / 20" in
  the UI after a page reload, not just in the immediate response.

**Not done**: no dedicated e2e test file was added for Purchasing (matches
Stock/Quality/Invoicing's own precedent of relying on real curl/browser
verification for milestone sign-off, formal `*.e2e.spec.ts` coverage added
separately if/when it becomes a priority). The demo org's test PO/receipt/
supplier created during Chrome verification were left in place — real,
correctly-functioning data, consistent with this demo org's existing
"real history built up live" character rather than a synthetic fixture.
