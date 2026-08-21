# Milestone 5 — Scan / Codes-barres

Barcode/QR label generation and the mobile-first scan flow, per Action Plan §7 milestone 5. The last of the 5 Phase 1 modules — Phase 1 (Stock, Quality, Invoicing, Multi-Sites, Scan) is now feature-complete.

## What was built

- **Schema fix**: `BarcodeLabel` was missing `orgId` (every other tenant-scoped table has one, per §2's own stated design rule) — added, with a `@@unique([orgId, codeValue])` constraint. Migration `20260821210000_scan_module`, applied to the dev database and both e2e test databases (table was empty everywhere, so no backfill needed).
- **`apps/api` ScanModule** — real controller/service behind the full guard chain (`@RequiresModule('scan')`, `@RequiresPermission('scan', ...)`): label generation, listing, print-count tracking, and `GET /scan/resolve/:code` (resolves a scanned/typed/keyboard-wedge-typed code to a product, in order: an existing label for that exact code → the code as a product SKU → the code as a batch lot number — falls back gracefully rather than requiring a label to have been formally generated first).
- **No new stock-movement or batch-creation endpoints** — by design (Action Plan §5: "Scan just calls the existing POST /stock-movements... not a distinct domain"). The frontend calls Stock's and Quality's existing endpoints directly for the actual IN/OUT/TRANSFER/new-lot actions; ScanModule's only job is label management and code resolution, which genuinely don't belong in Stock or Quality.
- **FEFO suggestion**: `resolveCode` also returns the earliest-expiring active batch for a lot-tracked product, for the OUT/TRANSFER flow's "suggested lot" — a UI suggestion only; Stock's own negative-stock check is what actually protects the ledger regardless of which batch ends up chosen.
- **Frontend `ScanPage`**: a genuinely mobile-first page (not the desktop Stock/Quality/Factures layout) — camera-based scanning via the `BarcodeDetector` API where the browser supports it, with manual/keyboard-wedge text input always available as the universal fallback (a hardware scanner just types into the same field). Full flow: scan/resolve → quantity → Entrée (existing lot / new lot with expiry + receipt quality check / no lot) → Sortie (FEFO-suggested lot shown, no partner selector — see below) → Transfert (destination site required) → confirm.
- **Permissions**: extended the seed's `scan` action list (`scan.label.generate`/`scan.label.print` already existed from the original scaffold's anticipation of this milestone) with `scan.label.read` and `scan.resolve.read`.

## Decisions made

1. **No partner selector on Scan's Sortie flow** — the wireframe's original mockup showed one, but `RecordMovementDto`/the stock-movement schema has no partner field at all; only an *invoice* records a partner, via a separate finalization flow (Milestone 4). A raw Scan-triggered OUT (shrinkage, internal consumption, a counter sale not yet invoiced) genuinely has no partner concept in this architecture. Dropped rather than built as a dead-end control with nowhere for the data to go.
2. **A real webpack/runtime bug found and fixed, same class as Milestone 4's**: none this time — Scan's backend has no dynamic `require.resolve` pattern, so this class of bug didn't recur here. Noting its absence explicitly since it was a real risk given the PDF service's precedent.
3. **Camera scanning requires a secure context** (HTTPS or `localhost`) per the `BarcodeDetector`/`getUserMedia` browser APIs themselves — not a bug, a standard browser security constraint. `nx serve web`'s `localhost:4200` satisfies this for local dev; a real deployment needs HTTPS for the camera path to work (the manual/keyboard-wedge input path has no such requirement and works anywhere).
4. **`BarcodeDetector` typed via a narrow, single-call-site `any` cast**, not a project-wide type declaration — it isn't in the standard TS DOM lib yet, and browser support itself is inconsistent (Chromium-based browsers only, as of this writing); the manual-input fallback is not a degraded mode, it's an equally real, permanent input path.
5. **Quality-at-receipt is optional but exposed inline** in the new-lot Entrée flow (Conforme/Non conforme toggle) rather than a separate step — matches how a real warehouse receipt actually happens (inspect while you're already handling the box), and reuses `POST /quality/checks` exactly as Milestone 3 built it, no new endpoint.

## How to verify

```bash
docker compose up -d && npm install
npm run prisma:migrate && npm run db:seed && npm run db:seed:demo
npx nx run-many -t lint build test
npx nx serve api   # :3000/api
npx nx serve web   # :4200
```
`npx nx run-many -t lint build test` passes clean (51/51 api tests, web builds/lints clean). Beyond the test suite, manually verified against the real dev database: `GET /scan/resolve/<sku>` resolves correctly with a FEFO suggestion, label generation works, and the full new-lot Entrée sequence a real scan drives (`POST /quality/batches` → `POST /quality/checks` → `POST /stock/movements` with the new `batchId`) was executed exactly as the frontend calls it and confirmed correct at every step — the stock level updated, and re-resolving by the new lot number correctly matched the newly-created batch. Interactive browser click-through (camera permission prompt, live video feed) was not performed — no browser tool available in this environment, same stated limitation as every prior milestone.

## Phase 1 status

All 5 Phase 1 modules (Auth/Tenancy, Stock + Multi-Sites, Quality, Invoicing, Scan) are now built, merged into `master`, and verified. Remaining per Action Plan §7: Milestone 6 (Hardening) — permission/entitlement edge cases, audit log completeness review, multi-site real-time load test, Super Admin module-activation onboarding UX, minimal per-module list/export views. Not yet started.
