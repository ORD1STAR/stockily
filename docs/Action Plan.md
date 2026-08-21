# Stockily — Phase 1 ("Fondations") Technical Plan

## Context

Stockily is a new, modular business-management platform (stock, quality, invoicing, growing toward a lightweight ERP) described in `Stockily_Conception_Application.pdf`. It targets any sector, lets customers activate modules à la carte (each priced independently), and ships in two modes — **Web** (multi-tenant cloud, multi-user, real-time multi-site) and **Local** (single device, offline, single all-in-one user) — with identical modules/UI in both.

The conception doc lists its own next steps as: validate scope → wireframes → pricing grid → tech stack → start Phase 1 dev. This plan is the "cadrer la stack technique" + pre-dev architecture step for **Phase 1 only** ("Fondations": Gestion de Stock, Gestion de Qualité, Gestion des Factures, Multi-Entrepôts/Multi-Sites, Codes-barres/QR/Scan mobile). The working directory is currently empty (greenfield) — this is an architecture/roadmap document, not code, and no scaffolding is created as part of it. Phases 2 (Achats, Commandes, Livraisons, CRM, Notifications) and 3 (Retours, Comptabilité, Rapports) are intentionally out of scope for implementation here, but every Phase 1 decision below is checked against not boxing them out later.

**Decisions already made (per user):**
- Stack: **TypeScript full-stack** — React (Vite) frontend, NestJS backend, PostgreSQL.
- Build order: **Web first**; Local mode is a later adaptation, not built now, but kept realistic by construction (see §6).
- Deliverable: architecture & roadmap only, no repo scaffolding yet.
- **Target market: Algeria** (not France — clarified after initial drafting; invoicing compliance below is researched against Algerian law specifically, not French).

---

## 1. High-level architecture

**Monorepo (Nx).** Nx's module-boundary lint rules (`@nx/enforce-module-boundaries`) mechanically prevent business logic from importing HTTP/auth/framework code — this is what keeps a future Local/Electron adaptation a bounded effort instead of a rewrite (§6), and a plain convention wouldn't hold over a multi-month build.

```
apps/
  api/              NestJS backend
  web/               React (Vite) frontend
  (later) desktop/   Electron/Tauri wrapper — not built in Phase 1
  (later) mobile/    native scan app, only if PWA proves insufficient
packages/
  domain-stock/ domain-quality/ domain-invoicing/ domain-tenancy/   — pure business logic, framework-agnostic
  shared-types/      DTOs/schemas shared FE ↔ BE
  shared-ui/         design system
  infra-db/          Prisma schema + repository implementations
  config/            eslint/tsconfig bases
```

**Backend: modular monolith**, not microservices. Stock/Quality/Invoicing are transactionally entangled at Phase 1 (finalizing an invoice line must decrement stock in the same transaction; a receipt creates a batch + a quality check together) — splitting into services now would force distributed-transaction complexity for no benefit at this scale. NestJS modules (`StockModule`, `QualityModule`, `InvoicingModule`, `SitesModule`, `ScanModule`, `AuthModule`, `TenancyModule`, `AuditModule`) give internal boundaries; cross-module access goes only through injected facade services, never direct cross-repository reach.

**Product module ≠ NestJS module.** NestJS modules load identically for every tenant at boot; Stockily's "à la carte" activation is a runtime, per-tenant concern. So:
- A `modules` registry table gets one row per product module — all 13 (`stock`, `quality`, `invoicing`, `sites`, `scan`, plus stubbed `purchasing`, `orders`, `delivery`, `crm`, `notifications`, `returns`, `accounting`, `reporting`), not just Phase 1's 5.
- `organization_module_entitlements` (org_id, module_id, status) + a `@RequiresModule('quality')` decorator and `ModuleEntitlementGuard` gate every route — this is the actual enforcement point for pay-per-module billing, server-side, never frontend-only.
- Frontend has a matching (non-authoritative) `ModuleAccessProvider` fed by `/me/entitlements`, used only for nav/UX.

---

## 2. Multi-tenancy & data model approach

**Shared schema, `org_id` on every tenant-scoped table, Postgres Row-Level Security (RLS) as defense-in-depth on top of app-level filtering.** Chosen over schema-per-tenant because: Phase 1 targets potentially many small/medium tenants (schema-per-tenant fans out migrations and complicates pooling past a few hundred tenants), and pay-per-module entitlement checks + cross-tenant admin/support tooling are simpler against one schema. RLS gives DB-enforced isolation even if application code has a filtering bug — valuable given invoicing (compliance) and quality (audit) data.

Mechanics: request-scoped transaction sets `SET LOCAL app.tenant_id = '<org_id>'`; RLS policies reference it; app-level `WHERE org_id = :orgId` stays the first line of defense (belt-and-suspenders, not RLS-only). Keep a nullable `database_shard` pointer on `organizations` as an escape hatch for a future whale customer needing dedicated isolation, without redesigning tenancy now.

**Core tenancy tables:** `organizations`, `modules` (key, phase, dependencies), `organization_module_entitlements`, `sites`, `users` (email globally unique across the platform for Phase 1 simplicity), `roles` (system defaults: Super Admin, Gestionnaire, Opérateur Entrepôt, Commercial, Comptable/Finance — the last two are Phase 2/3-facing but defined now), `role_permissions` (role_id, module_id, action), `user_roles` (user_id, role_id, **site_id nullable** = org-wide vs site-scoped — this is the mechanism for per-role/per-module/per-site permissions).

**Permission model: RBAC + a site-scoping dimension**, not full ABAC — matches the doc's requirement without over-engineering. Effective permission = `user → user_roles (site-scoped or not) → role_permissions(module, action)` **intersected with** `organization_module_entitlements` — enforce both in one guard chain so a role's permission can never silently outlive a lapsed module entitlement.

---

## 3. Core domain data model — Phase 1 modules

- **Stock**: `products` (org_id, sku, category_id, **single unit of measure** — no multi-UoM/conversion model in Phase 1, a "case of 12" is its own product if needed, `is_lot_tracked` bool, min/max thresholds, **`average_cost`** updated on each IN movement — Weighted Average Cost valuation, not FIFO), `product_categories` (tree). **No variant model** — a size/color variant is its own product record, not a parent+variant structure. `stock_levels` (product_id, site_id, quantity_on_hand, **`quantity_quarantined`** — stock in a failed-quality/expired state, excluded from sellable/available quantity, `quantity_reserved` stubbed for Phase 2 — all projections, not source of truth). **`stock_movements` as an append-only, immutable ledger** (type IN/OUT/TRANSFER/ADJUSTMENT, `batch_id` nullable, polymorphic `related_entity_type/id`, performed_by, occurred_at — `stock_levels` updated transactionally alongside each insert). **No edit/delete on posted movements** — a mistaken entry is corrected only via a new offsetting/reversal movement, preserving full audit trail. **Negative stock is blocked by default**: an OUT/TRANSFER movement or invoice-line finalization that would take `quantity_on_hand` below zero is rejected. `stock_transfers`. The ledger-first, immutable design is what lets Phase 3 Rapports and Phase 2/3 reversal flows (returns) hook in additively instead of being retrofitted.
- **Quality**: `batches`/`lots` (expiry_date, status), `quality_checks` (**`batch_id` nullable**), `non_conformities` (**`batch_id` nullable**), a lightweight `expiry_alerts` log (avoids re-alerting, doubles as a ready-made source for Phase 2 Notifications). `stock_movements.batch_id` is populated only when `products.is_lot_tracked = true` — this is the doc's "stricter lot tracking for pharma via configuration" pattern implemented as a per-product flag, not a sector branch in code. **A quality check is not limited to lot-tracked products.** A non-lot-tracked product (e.g. a belt) can't have an expiry-driven check, but still needs an ad hoc one — a delivery-defect inspection with no batch — so `quality_checks`/`non_conformities` reference the product/stock movement directly when there's no batch to attach to, instead of requiring one. **A failed quality check — with or without a batch — or a batch reaching its expiry date, automatically moves its quantity from `quantity_on_hand` into `quantity_quarantined`** (this field lives on `stock_levels`, not on the batch, so quarantine works identically either way) — quarantined stock cannot be sold, shipped, or transferred; it can only be moved via an explicit disposal/write-off movement (or, later, a Phase 2/3 return-to-supplier flow) — this is enforced by the system, not left to staff discretion.
- **Invoicing**: `invoices` (type customer/supplier, **currency fixed to DZD in Phase 1** — no multi-currency/exchange-rate handling yet, though a `currency` column defaulted to `DZD` keeps the door open, **one gapless sequential number per organization across all sites** — required by Algeria's Décret Exécutif 05-468), `invoice_lines` (product_id **nullable**, so services-only businesses can invoice with no Stock module at all — Invoicing does not depend on Stock, confirmed; **`discount_percent`/`discount_amount` at line level**, applied before tax calculation), `tax_rates`, **`payments`** (invoice_id, amount, method, paid_at — **multiple partial payments per invoice supported**, invoice status tracks unpaid → partially paid → paid against a running balance), `invoice_reminders`.
  - **Unified `partners` table** (not separate `customers`/`suppliers`) — one record per real-world company/individual, with `is_customer`/`is_supplier` boolean flags (both can be true) — avoids duplicate records for a partner your user both buys from and sells to, and matches how Phase 2 CRM/Purchasing will extend the same table. **`nif` is a required field** — 2022 Algerian finance law ties buyer VAT deduction to it.
  - **Algerian compliance (Décret Exécutif 05-468) is a Phase 1 requirement, not a later research task**: invoices must carry the 12 mandatory mentions — company name/legal form, address, NIF, NIS, tax article number, Commercial Register (RC) number, gapless sequential number, date, itemized goods/services, HT amount + VAT rate/amount, TTC total **in figures and in words**, and payment terms. Enforce buyer NIF at invoice finalization (blocking, with an explicit override path for cash/walk-in customers who may not have one).
  - **Bilingual French/Arabic output from day one** (labels, layout, and amount-in-words in both languages — Arabic requires RTL layout and its own number-to-words conversion, not just a translated string table). This is a real scope item, not a footnote — budget for it explicitly in the Invoicing milestone, not as a fast-follow.
  - `transmission_status` — a nullable placeholder field only, for Algeria's DGI e-invoicing/CTC platform. No active integration work in Phase 1: the mandate has slipped past 2026 with no finalized spec (realistically 2027+).
- **Multi-site**: no separate modeling — `sites` + `site_id` present on every Stock/Quality/Invoicing row **from day one** (see roadmap note below: this must not be bolted on after Stock ships). Consolidated vs per-site views are the same queries, filtered or not.
- **Barcode/Scan**: `barcode_labels` (product_id or batch_id, code_value, symbology). No separate "scan session" entity — a scan just calls the existing `POST /stock-movements` with `source: 'scan'` metadata, keeping Scan an input-method concern rather than a distinct domain.

---

## 4. Cross-cutting concerns

- **AuthN**: JWT access token + rotating refresh token (revocable via a `refresh_tokens` table, enabling logout-everywhere).
- **AuthZ guard chain** (order matters): `JwtAuthGuard` → `ModuleEntitlementGuard` → `PermissionGuard` → `SiteScopeGuard`. Distinguish entitlement failures (→ upgrade CTA) from permission failures (→ generic forbidden).
- **Audit trail**: generic `audit_log` (org_id, actor, entity, action, diff, occurred_at), populated via an interceptor across Stock/Quality/Invoicing from day one — a stated differentiator ("traçabilité native"), and a direct input to Phase 3 Comptabilité/Rapports.
- **API style: REST**, not GraphQL. Module-entitlement gating is naturally route-level (harder to enforce/audit per-field in GraphQL for a billing-critical concern); resource-oriented domains map cleanly to REST; OpenAPI/Swagger + the `shared-types` package give typed clients without GraphQL codegen. Revisit only for a possible Phase 3 Rapports aggregation BFF.
- **Module dependency rules** (encoded in `modules.dependencies`, enforced at activation time): **Quality requires Stock** (batches/quality checks anchor to stock products/movements, so Quality has nothing to attach to without it). **Invoicing does not require Stock** — a pure-services business can activate Invoicing standalone (`invoice_lines.product_id` is nullable specifically for this), matching the doc's "any sector" promise.
- **Ledger/audit-log retention & partitioning — decided now, not deferred.** Algeria's Commercial Code (Article 12) requires **10-year retention** of accounting books and supporting documents (invoices included; DGI audits reach back 4 fiscal years). `stock_movements`, `audit_log`, and `invoices` are append-only and must support this from day one:
  - Postgres **native range partitioning by month** on `occurred_at`/`created_at` for `stock_movements` and `audit_log` (declarative partitioning, new partition created by a scheduled job each month).
  - No deletion job in Phase 1 — retention is a *minimum*, not a rolling window; partitioning here is for query/index performance and future cold-storage migration, not for purging data.
  - A yearly archival job (move partitions older than ~2 years to cheaper storage/a read-only replica) is a Phase 1-adjacent operational task, not blocking — schema must support it (partitions are already isolated units), implementation can land shortly after launch once real volume is known.
- **Real-time multi-site sync**: NestJS `@WebSocketGateway` (Socket.IO) broadcasting to `org_id`/`site_id` rooms, fed by domain events (`StockMovementCreatedEvent`, etc.) via `EventEmitter2` — the same event seam Phase 2/3 modules (Notifications, Achats, Rapports) will subscribe to later. **Single-instance deployment confirmed for Phase 1** (matches pilot-customer pace) — no Redis pub/sub adapter needed yet; add one only if/when horizontal scaling becomes a real plan.
- **Scan/mobile companion — PWA core, wrapped for app-store presence.** Build the scan UI as a React PWA (camera-based `BarcodeDetector`/ZXing, which also transparently accepts USB/Bluetooth HID keyboard-wedge scanner input as plain text-field input) — **confirmed**: operators use a mix of personal/company phones (camera scanning) and dedicated scanner hardware (keyboard-wedge), so both input paths are needed regardless. App-store presence **is required** (confirmed with stakeholders, independent of marketing — a functional/distribution requirement), so wrap the same PWA with **Capacitor** for iOS/Android store listing rather than building a separate React Native app — keeps one codebase for Web, scan, and the store-listed app.
- **ORM: Prisma** (over TypeORM) — better TypeScript type-safety/DX; its middleware/extension mechanism cleanly wraps queries to issue the RLS `SET LOCAL app.tenant_id` session variable per request.

---

## 5. Extensibility check for Phase 2/3 (not designed now, just validated)

Achats receipt → additive IN `stock_movement` + reuse of the already-modeled `quality_check`. Commandes → reads `stock_levels`/`quantity_reserved` (already stubbed) and the same OUT-movement mechanism invoicing uses. Livraisons → attaches to `stock_transfers`, no schema change. CRM → extends `customers` with new related tables. Notifications → subscribes to domain events already emitted for real-time sync. Retours → reverse `stock_movement` + a credit-note row in the existing `invoices` table. Comptabilité → consumes `invoices`/`payments` already modeled. Rapports → aggregates over the append-only ledger + `audit_log`, both present from day one. The single load-bearing choice enabling all of this: **ledger-first Stock + domain events from day one.**

---

## 6. Local-mode readiness (not built now)

- Strict layering: `packages/domain-*` never imports Nest/Express/HTTP/auth types; domain services take a pre-resolved `TenantContext` + plain data, Nest controllers/guards are a thin adapter. Enforced by Nx boundary lint in CI, not just convention — this is what makes a later Electron/Tauri Local variant a bounded adaptation.
- Tenancy resolution (RLS vars, org_id) lives in the adapter layer only; Local's `TenantContext` can later be a hardcoded single-org/single-user stub with no login flow, no RLS.
- Repository-pattern interfaces in `domain-*`, concrete Prisma implementations in `infra-db` — keeps the DB engine swappable in principle without touching business logic. **Do not over-build a pluggable multi-DB engine now** — a lightweight interface discipline is enough for a mode not yet being built.
- Entitlement checks sit behind an `EntitlementChecker` interface — Web checks a DB table; a future Local implementation could check a license file, same interface, zero domain-code changes.

---

## 7. Execution roadmap for Phase 1

1. **Platform bootstrap** — Nx monorepo, CI, NestJS skeleton, Postgres + migrations, org signup/login/JWT+refresh, full RBAC + entitlement guard chain, `modules` registry seeded with all 13 keys (5 wired), `audit_log` infra, React app shell.
2. **Stock + Multi-site, built together** — `site_id` must be on Stock tables from the start; treating Multi-site as an "after Invoicing" module (per a literal reading of the doc's list) would force a painful migration later. Deliver products/categories, sites, the movements ledger (IN/OUT/TRANSFER/ADJUSTMENT), threshold alerts, inventories/adjustments, consolidated + per-site views, per-site permission enforcement, domain events → websocket.
3. **Quality** — batches/lots, expiry tracking + near-expiry alerts, receipt quality checks (manual entry, no Purchasing yet), non-conformities. Depends on Milestone 2 (`batch_id` FK).
4. **Invoicing** — tax rates, lightweight customers/suppliers (with required NIF), invoices/lines/payments, the 12 Décret 05-468 mandatory mentions including amount-in-words, bilingual French/Arabic output (RTL layout + dual number-to-words), PDF/email export, `transmission_status` placeholder field, a lightweight scheduled reminder job (not the full Phase 2 Notifications center). Does **not** depend on Stock — usable standalone, but a line referencing a stock product still triggers a stock OUT movement on finalization when Stock is active.
5. **Scan/Barcode** — generation, label printing, PWA scan view (camera-based + keyboard-wedge hardware input) wired into existing stock-movement endpoints, then wrapped with Capacitor for iOS/Android app-store listing — mostly frontend, tested against Stock + Quality (lot scanning) and the Opérateur Entrepôt role.
6. **Hardening** — permission/entitlement edge cases, audit log completeness, multi-site real-time load test, seed/migration scripts, Super Admin module-activation onboarding UX, minimal per-module list/export views (not full Phase 3 Rapports).

---

## 8. Decisions resolved with stakeholders (2026-08-21)

All open risks from the initial draft were discussed and resolved:

1. **Shared-schema + RLS confirmed** — no anchor customer currently requires dedicated isolation; pilot-customer pace makes this comfortably sufficient.
2. **Managed Postgres** (Supabase/Neon/RDS) chosen as deployment target; a short technical spike will validate `SET LOCAL`/RLS behavior under the provider's pooling before building on top of it.
3. **Invoicing compliance is Algerian, not French** (target market corrected to Algeria) — Décret Exécutif 05-468's 12 mandatory mentions, gapless per-org numbering, and required buyer NIF are researched and concrete enough to build against directly, no formal legal sign-off blocking Phase 1. Bilingual French/Arabic invoice output is in scope for Phase 1. DGI e-invoicing (CTC/5-corner model) gets a placeholder field only — mandate has slipped to 2027+ with no finalized spec.
4. **Single-instance deployment confirmed** for Phase 1 launch — no Redis adapter needed yet.
5. **Mobile companion needs real app-store presence** (a functional/distribution requirement, not primarily marketing) — build as a PWA, wrap with Capacitor for iOS/Android listing. Scan input supports both camera-based scanning and keyboard-wedge hardware scanners, since operators use a mix of both.
6. **ORM: Prisma**, chosen for TypeScript DX and clean RLS session-variable integration via its middleware/extension mechanism.
7. **Module dependencies confirmed**: Quality requires Stock; Invoicing does not (standalone activation supported for services-only businesses).
8. **Invoice numbering: one gapless sequence per organization**, spanning all sites (not per-site).
9. **Ledger/audit-log retention: decided now.** Algeria's Commercial Code Article 12 mandates 10-year retention — monthly Postgres range partitioning on `stock_movements`/`audit_log` from day one (no purge job; a yearly cold-storage archival job can land shortly after launch once real volume is known).

---

## 9. Business/"métier" decisions resolved (2026-08-21)

Functional ambiguities not settled by the conception doc, resolved before dev start:

1. **Stock valuation: Weighted Average Cost.** `products.average_cost` recalculated on each IN movement — no FIFO lot-costing, no per-batch cost tracking.
2. **Single unit of measure per product.** No multi-UoM/conversion (case↔unit) model in Phase 1.
3. **Negative stock blocked by default.** Any OUT/TRANSFER or invoice-line finalization that would take `quantity_on_hand` below zero is rejected.
4. **No product-variant model.** Each size/color/etc. variant is its own product record.
5. **Currency: DZD only.** A `currency` column defaults to `DZD`; no exchange-rate handling in Phase 1.
6. **Automatic quarantine.** A failed quality check or expiry automatically moves quantity into `quantity_quarantined`, excluded from sellable/available stock — not just an alert.
7. **Line-level invoice discounts** (percent or fixed amount), applied before tax.
8. **Partial/installment payments supported** — an invoice tracks a running balance (unpaid → partially paid → paid) across multiple payments.
9. **Unified `partners` table**, not separate customers/suppliers — one record flagged `is_customer`/`is_supplier` (both can be true).
10. **Stock ledger is fully immutable.** No edit/delete on posted movements, ever — corrections are always a new offsetting/reversal entry, for any role.

These are folded into §3's data model above.

---

## 10. UI/UX decisions resolved (2026-08-21)

1. **Visual style: generic clean business-app UI for the architecture phase** — a neutral component-library look (e.g. shadcn/ui or MUI) unblocks Phase 1 build. **The user wants a dedicated branding pass right after this planning session** (logo, palette, visual identity) — treat this as an explicit next action item, not a "defer indefinitely" decision (see Verification below).
2. **Navigation: collapsible sidebar grouped by module**, showing only the org's active modules (inactive ones greyed out with an upgrade CTA) — scales cleanly as more of the 13 modules activate over time.
3. **UI language: French-only for Phase 1.** Only invoice *documents* need bilingual FR/AR output (per §9/§3) — the app interface itself (menus, forms, buttons) is not localized/RTL in Phase 1.
4. **Device priority: desktop-first for the Web back-office** (Stock, Quality, Invoicing, admin screens), **mobile-first only for the Scan PWA** — matches actual usage context (desk work vs. warehouse floor) rather than building full responsive design everywhere.

---

## 11. Pricing grid — Phase 1 (resolved 2026-08-21)

**Model: à la carte, per module, per site** — no seats/users counted, no bundled global plan. Same price whether the org runs Web or Local. All amounts in DZD (per the DZD-only decision in §9).

| Module | Dependency | Monthly (DZD/site) | Annual (DZD/site) |
|---|---|---|---|
| Gestion de Stock | none (socle) | 4 500 | 45 000 |
| Qualité | requires Stock | 3 000 | 30 000 |
| Factures | none — usable standalone | 4 000 | 40 000 |
| Multi-Sites | 1st site included; priced per *additional* site | 1 500 | 15 000 |
| Scan / QR | requires Stock | 2 000 | 20 000 |

**Multi-Sites pricing rule**: the price of the other modules already covers a first site, so activating Multi-Sites costs nothing for that first site — the 1 500/15 000 DZD figure only bills for each additional site opened after that. A single-site customer never needs to activate it.

**Bundle**: "Pack Fondations" (all 5 modules, first site) at **10 900 DZD/mois** (**109 000 DZD/an**) vs. 13 500/mois à la carte — the discount is the default cross-sell for a new customer choosing Phase 1 wholesale rather than module-by-module.

**Billing**: monthly by default, no commitment; annual option priced at 10× monthly (2 months free) as the retention lever. **Free trial: 15 days, any chosen modules, no card required** — no permanent free tier.

These figures are a working v1 to validate with early customers, not final pricing-committee numbers — revisit once pilot customers give real willingness-to-pay signal.

---

## Verification

This is an architecture/roadmap document, not code — there is nothing to run yet. All decisions in §8, §9, §10, and §11 are now resolved with the stakeholder; the plan reflects them throughout §§1–7. Branding (locked) and wireframes (locked) are done; pricing (§11) is now drafted. Next step: repo scaffolding for Phase 1 development.
