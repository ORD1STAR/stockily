# Milestone 10 — Gestion Achats & Gestion Ventes split

Phase 2, round 2: the single-purpose Achats module from Milestone 9 is
restructured into two symmetric, independently-priced modules — **Gestion
Achats** (supplier cycle: RFQ → BC → réception avec coût de revient →
facture fournisseur) and **Gestion Ventes** (brand new, customer cycle:
devis → commande avec réservation de stock → facture client). Full context
and the 31 decisions behind this design: the approved plan at
`/home/ordistar/.claude/plans/je-veux-passer-composed-teacup.md` (referenced
here since, unlike earlier milestones, this one wasn't preceded by its own
numbered doc — the plan doc *is* that record).

Built under an explicit autonomy grant from the user ("tu es le gérant...
choisis ce que tu recommende... tu t'arrêtes uniquement quand tout
fonctionne sans bugs") — every open design call from here down was made
directly, verified in Chrome against `stockily.ordi-tech.com`, and fixed in
place rather than flagged back.

## What was built

- **Schema**: `SalesOrder`/`SalesOrderLine`/`SalesOrderCounter` (the same
  "header + lines" + atomic counter pattern as `PurchaseOrder`/`Invoice`) and
  `PartnerProductPrice` (negotiated per-customer pricing). `Partner` gained
  `paymentTermsNetDays`; `Invoice` gained `dueDate` (computed once at
  SUPPLIER creation from the partner's terms) and `salesOrderId`;
  `InvoiceLine` gained `salesOrderLineId`; `PurchaseOrder` gained
  `comparisonGroupId` + two new statuses (`rfq`/`rfq_rejected`);
  `PurchaseReceipt`/`PurchaseReceiptLine` gained landed-cost fields. All new
  tables got their own RLS migration, same pattern as Milestone 8/9.
- **Stock reservations, finally wired up** (`StockLevel.quantityReserved`
  had been a stubbed-but-unused column since Milestone 1):
  `StockMovementService.reserve`/`release` in `@org/domain-stock`, plus a
  **transversal fix** to the existing OUT/TRANSFER negative-stock check —
  it now compares against `quantityOnHand - quantityReserved`, not just
  `quantityOnHand`. One change in the shared domain primitive means Vente
  rapide, manual Stock sorties, and inter-site transfers all respect a
  commande's reservation automatically, with no per-caller special-casing.
  A commande's creation is a strict-then-confirm flow: a shortage returns
  HTTP 409 with the exact deficit, the client resubmits with
  `acknowledgeShortage: true` to accept a backorder.
- **`SalesModule`**: devis/commande CRUD, promotion (devis → commande gets a
  fresh `CMD-...` number, keeps `promotedFromQuoteNumber` pointing at the
  original `DEV-...`), cancellation (releases whatever's still reserved),
  partial/multi-invoice generation from a commande (`InvoicingService
  .createInvoice` reused as-is — Ventes never duplicates Invoicing's own
  finalize/payment logic), and `PartnerProductPrice` CRUD. No
  `@org/domain-sales` package — same reasoning as Purchasing has none: this
  module is orchestration over Stock/Invoicing primitives, not new domain
  logic of its own.
- **RFQ / comparaison fournisseurs**: reuses `PurchaseOrder` with the new
  `rfq`/`rfq_rejected` statuses instead of a dedicated entity — one
  `comparisonGroupId` correlates N candidate POs (one per invited
  supplier), `PATCH /purchasing/rfq/orders/:id/prices` lets the buyer fill
  in each supplier's quoted price once received, `POST .../award/:id`
  assigns the winner a real BC number and closes out the rest as
  `rfq_rejected`.
- **Landed cost**: `PurchasingService.receiveGoods` now pro-rates a
  receipt's lump `landedCostAmount` across lines by value
  (`unitCost × quantity`), feeding a `landedUnitCost` into the WAC while the
  raw `unitCost` stays on `PurchaseReceiptLine` for price-history purposes.
  Absent/zero `landedCostAmount` is byte-identical to before this
  milestone.
- **Frontend**: `SalesPage.tsx` (new, mirrors `PurchasingPage.tsx`'s
  patterns), `PurchasingPage.tsx` extended with RFQ creation/comparison/
  award, landed-cost fields on receiving, last-price-paid hints, a
  dashboard strip, and a supplier-invoice modal. `AppShell`'s sidebar had a
  stale hardcoded "Achats — Phase 2 (verrouillé)" stub left over from before
  Milestone 9 built it for real — removed now that both Achats and Ventes
  are real entries in `PRODUCT_MODULES`. Scan gained a third mode,
  "Réception rapide" — the same running-cart UX as Vente rapide, composing
  the existing `POST /purchasing/receipts` (réception libre) instead of an
  invoice.
- **`seed.ts`**: `purchasing` now depends on `invoicing` too (the facture
  fournisseur step); the long-orphaned `orders` module stub is renamed to
  `sales` (`deps: ['invoicing']`) and its dangling `Module` row deleted;
  new `ACTIONS.sales`; Commercial/Opérateur Entrepôt/Comptable roles
  updated for both sides of the ledger.

## Bugs found only by actually using it — fixed in place, not flagged back

Consistent with every prior milestone's own experience (and this session's
explicit mandate to keep going until nothing is broken): build/lint/
typecheck/tests were clean throughout, none of these four surfaced until
real use in Chrome against `stockily.ordi-tech.com`.

1. **RFQ candidates had no way to ever get a real price.** `createRfq`
   creates every candidate line at `unitCost: 0` by design (the buyer fills
   it in once a supplier actually quotes) — but no endpoint existed to edit
   it, so the comparison table always showed 0.00 DZD for every supplier,
   making the whole feature non-functional for its actual purpose. Added
   `PATCH /purchasing/rfq/orders/:id/prices` (only touches lines still on
   an `rfq`-status order) and made the comparison modal's price cells
   editable inputs with a per-supplier save.
2. **Vente rapide could leave an invisible orphaned draft invoice.**
   `finalizeSale` is one click standing in for `createInvoice` +
   `finalizeInvoice` — once reservations could make the second call fail
   (a shortage the cashier has no way to see coming, since Vente rapide
   never goes through the preview-then-confirm flow Ventes' own commande
   creation has), the draft invoice from the first call was left behind
   with no error pointing at it. Fixed by voiding the draft on a finalize
   failure — best-effort, since the sale itself already failed and a void
   failure isn't worth surfacing on top of that.
3. **`AppShell`'s sidebar listed "Achats" twice** — once correctly (via
   `PRODUCT_MODULES`, entitlement-gated) and once as a hardcoded
   `Phase 2, verrouillé` stub nobody removed when Milestone 9 actually
   built it. Removed the stale stub.
4. **A batch RLS write pattern that would have silently miscomposed.**
   Caught in review before it ever ran, not in Chrome: `updateRfqLinePrices`
   was first written using `prisma.$transaction([...])` (the array/batch
   form) for a set of line updates. `packages/infra-db`'s RLS extension only
   special-cases *interactive* transactions
   (`prisma.$transaction(async (tx) => ...)`, detected via
   `__internalParams.transaction`) — a batch array of promises isn't one,
   so each line update risked being independently re-wrapped in its own
   throwaway `set_config` transaction, breaking the atomicity the multi-line
   write needed. Rewritten to the established interactive-transaction +
   `setTenantOnTransaction` pattern every other multi-write call site in
   this codebase already uses.

## Verification

```bash
npx nx run-many -t lint typecheck build test --projects=web,api,domain-stock,infra-db
```
Green except `@org/api:typecheck`'s 4 known e2e-spec errors (unrelated,
pre-existing since Milestone 7 Round 6). 51 api tests + 22 domain-stock +
1 infra-db pass. (Nx running `typecheck` and `build` for the same project
in parallel with a shared `dist/` occasionally races and reports spurious
extra `TS6305` errors — confirmed by re-running `typecheck` alone in
isolation each time this happened; the real count is always exactly 4.)

Beyond the suite — real Chrome against `stockily.ordi-tech.com`, plus
direct `curl` against the same deployed API for a few flows the browser
extension dropped mid-session on:

- **Devis → commande → reservation**: created a devis, promoted it (fresh
  `CMD-...` number, `promotedFromQuoteNumber` correctly pointing at the
  `DEV-...`), confirmed `StockLevel.quantityReserved` incremented by
  exactly the ordered quantity.
- **Shortage preview + backorder**: ordered 200 of a product with far less
  available, got the exact 409 message with the real deficit
  (`quantityOnHand - quantityReserved`), confirmed with
  `acknowledgeShortage: true`, confirmed `quantityReserved` landed at the
  full backordered amount (not capped at on-hand).
- **Vente rapide respecting the reservation** — the transversal fix's whole
  point: with a product deeply over-reserved from the above test, a Vente
  rapide sale of the same product was blocked with the same
  `available: -N` message a manual Stock sortie would get, and (bug #2)
  left no orphaned draft behind afterward.
- **Cancellation releases the reservation**: cancelled a commande, confirmed
  `quantityReserved` dropped back by exactly what was released.
- **Partial invoicing releases proportionally**: invoiced 5 of a 5-unit
  line on a healthy-stock product, finalized it, confirmed the reservation
  went to 0, `quantityInvoiced` incremented, and `quantityOnHand` actually
  decremented — while a *separate* attempt to finalize an invoice against
  an over-reserved backordered line correctly stayed blocked (reservation
  ≠ real stock; you can promise a backorder, you still can't ship it).
- **RFQ end to end**: created a 2-supplier comparison, entered different
  quoted prices per candidate (bug #1's fix), awarded the cheaper one —
  confirmed the winner got a real `BC-...` number and `confirmed` status,
  the loser flipped to `rfq_rejected` with no number ever assigned.
- **Landed cost**: received 10 units at a raw `unitCost` of 1000 with a
  500 DZD landed cost on a product already at 66 on hand / 1030.91 WAC —
  confirmed the new WAC (1033.42) matches the value-weighted-average
  calculation by hand, and the receipt line's raw `unitCost` (1000, for
  price history) stayed separate from its persisted `landedCostShare`
  (500).
- **Negotiated pricing**: set a `PartnerProductPrice` for a customer/product
  pair, created a new commande line for that exact pair with no explicit
  price — confirmed the line resolved to the negotiated price, not
  `Product.sellPrice`.
- **Supplier invoice + dueDate**: generated a facture fournisseur from a
  partially-received BC through the actual UI; confirmed `dueDate` stays
  `null` when the supplier has no `paymentTermsNetDays` set (correct, not a
  bug) by reading `computeDueDate`'s logic directly.
- **Scan → Réception rapide**: added a product via manual code entry,
  set quantity/unit cost, confirmed the receipt — `quantityOnHand` and
  `averageCost` both updated correctly, matching the same math as the
  desktop landed-cost test above.

**Module activation**: still no self-serve module-purchase UI (same
still-open item Milestone 9's own doc already flagged) — `sales` was
entitled for the demo org directly via a small one-off Prisma script
against the deployed database, not through any endpoint, since none exists
yet for *any* Phase 2 module.

**Left in place**: the demo org's test RFQ comparison, its second supplier,
the negotiated price, and the sales/purchase orders created during Chrome
verification — real, correctly-functioning data, same "real history built
up live" character as every other milestone's own Chrome pass, not a
synthetic fixture cleaned up afterward.
