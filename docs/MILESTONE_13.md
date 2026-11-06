# Milestone 13 — Public site, self-service subscription, Espace client

Five things, all server-side/web (the desktop app keeps its license-driven
entitlements: `BillingModule` is **not** loaded in local mode).

## A. Dashboard (accueil)

- The "Déconnecter tous les appareils" card is gone.
- **Applications** now lists the modules the org owns first, in colour; the
  ones it hasn't unlocked follow under "À débloquer", in black & white. Clicking
  one opens the purchase flow (`PurchaseModal`). Same on the sidebar (a locked
  module becomes a "Débloquer" button) and on the phone home / launcher.
  Owned tiles show a badge only in the last 7 days of a trial / paid period.
- **Every KPI card and to-do opens the list behind it, filtered and sorted**
  (`DashboardPage` `LINKS`): Ruptures → `/stock?f.status=out&sort=qty:asc`,
  Solde impayé → `/invoicing?f.rest=1&sort=rest:desc`, Commandes clients →
  `/sales?kind=order&f.open=1…`, Achats en cours → `/purchasing?f.open=1…`,
  plus late deliveries, non-conformités, lots proches de la péremption.
- Mechanism: `ListControls` now reads its initial state from the URL
  (`f.<key>=value`, `f.<key>.min/.max/.from/.to`, `q=`, `sort=key:dir`), only for
  keys the list defines. New flags: Achats `open`/`late`, Ventes `open`/`late`
  (+ `?kind=`), Qualité got the shared search/filter/sort bar (`nc`, `soon`,
  `expired`). Cash reads `?dir=`, Achats reads `?tab=`.
- **Statistiques**: every figure is a link (CA, nombre de ventes, encaissé,
  achats, créances, dettes, ruptures, lots périmés, and each ranked product /
  client / supplier), carrying the period as `f.date.from/to`.

## B. Public site (vitrine) at `/`

`apps/web/src/site/`: `HomePage` (hero with an HTML/CSS product mockup,
features, scan + offline sections, steps, pack teaser, CTA), `AboutPage`,
`PricingPage` (+ FAQ), shared `SiteLayout` (sticky header, mobile menu, footer).
`*` now redirects to `/` instead of `/dashboard`; `ProtectedRoute` redirects to
`/login?next=<path>`, and login/signup honour a same-site `next`.

- Logged out: **Se connecter** + **Créer un compte**.
- Logged in: two captioned buttons instead — **Espace client** ("Abonnement &
  compte") and **Mon Business** ("Ouvrir l'application").

## C. Subscription backend (`modules/billing`, migration `20261106120000_billing_self_service`)

- Schema: `OrganizationModuleEntitlement.expiresAt/autoRenew`,
  `Organization.creditBalance`, `User.phone`, `PlatformPayment.kind/number/items/creditUsed/userId`.
  Default prices added for purchasing/sales/cash/stats (never overwrites an admin's price).
- `ModuleEntitlementGuard`, `LicensingService`, the admin service and the web
  `entitledModuleKeys` all honour `expiresAt` (a lapsed period is refused even
  if its status is still `active`). Admin "activate" sets `expiresAt = null`.
- Runs on the superuser client (`AdminPrismaService`, exported by `AdminModule`)
  because `module_prices` / `platform_payments` are RLS deny-all; every query is
  scoped to the JWT's `orgId`. Only users holding `members.user.manage` can
  spend (purchase, top-up, auto-renew); others get a read-only view.
- `GET /billing/catalog` (public), `GET /billing/me`, `POST /billing/purchase`,
  `POST /billing/credit`, `PATCH /billing/auto-renew`, `GET /billing/payments/:id/pdf`,
  `GET/PATCH /account`, `POST /account/password`.
- **No payment provider yet**: a purchase is paid from the credit balance, or
  `payWith: 'offered'` activates immediately and is recorded as "Activation
  offerte (paiement en ligne à venir)"; top-ups are likewise offered. The
  payment API plugs in at `BillingService.purchase`/`topUp` (the two places that
  currently mark a payment `paid` directly).
- Rules: 12 months are billed 10; a **pack's price is the sum of its modules**
  (4 packs: Starter, Commerce, Pro, Business — `billing.catalog.ts`); dependencies
  not already running are added and billed; buying a running period **extends**
  it, buying during a trial keeps the remaining trial days; the balance is
  decremented with a conditional `UPDATE … WHERE creditBalance >= amount` (no
  overdraw under concurrency); invoice numbers `STK-YYYY-NNNNNN` under an advisory lock.
- `BillingScheduler` (hourly): renews auto-renew modules due within 24 h by one
  month from the credit (a trial with auto-renew converts to paid), then marks
  lapsed periods `expired`.

## D. Espace client (`/compte`)

Tabs: Vue d'ensemble, Mes modules (time left, progress, per-module **and**
global auto-renew switch, prolong/reactivate, buy others), Acheter des modules
(packs + à la carte + selection cart + duration), Paiements & factures (history,
PDF), Solde & renouvellement (top-up), Mon compte (display name, email,
username, phone, password). The same `PricingSection` / `PurchaseModal` serve
the public Tarifs page (logged in it shows what is owned and for how long).

## Verified

- `nx run-many -t lint typecheck build test --projects=web,api,domain-stock,infra-db`:
  API 16 suites / 102 tests (new: `billing.service.spec`, `billing.e2e.spec` — catalogue
  = sum of packs, auth, purchase, dependency billing, 10-for-12, extension, credit
  never overdrawn, PDF + cross-org isolation, auto-renew toggles, **expiry enforced by
  the guard**, hourly renewal job, account edits, email uniqueness); web 2 tests.
  `@org/api:typecheck` shows only the known e2e-spec `import()` quirk (8 now);
  `@org/web:lint` has 2 pre-existing `react-hooks/exhaustive-deps` rule-definition
  errors (ScanPage, AdminSqlPage).
- Headless Chromium (Playwright, desktop 1360 and phone 390 px, on the live HTTPS
  host): vitrine pages, logged-in header, locked-app purchase end to end, every
  Espace client tab, profile save, PDF download, auto-renew switches, dashboard
  and Statistiques cards landing on filtered lists, no horizontal overflow.

## Round 2 (feedback pass)

- **Texts**: no more long dashes in user-facing strings (web and API messages / PDFs); marketing rewrite
  (benefit-led copy on the home, packs, FAQ); the scan section now says phone **or douchette** (USB / Bluetooth);
  a short trial note for visitors; readable text selection everywhere (`::selection` incl. gradient headings and dark bands).
- **Commercial gesture**: 1 month = normal price, 6 months = 1 month offered, 12 months = 2 months offered
  (`DURATIONS.billedMonths`); the recap shows full-price lines and the free months as a deduction.
- **Multi-sites**: removed from the 15-day trial (trial = Stock, Qualité, Factures, Scan). The **first site is free for
  life**; extra sites cost 1 500 DZD/month each, chosen with a stepper at purchase (`extraSites`, stored as
  `OrganizationModuleEntitlement.siteQuota`, enforced in `SitesService.createSite`; renewals charge `price x quota`).
  `GET /sites` no longer needs the module (almost every page lists sites); creating sites and transfers do.
- **"Proposer des ajouts"**: public form on `/` (and footer) -> `POST /suggestions` (5 / 10 min / IP, honeypot,
  `feature_suggestions` table, RLS deny-all, excluded from device snapshots) -> admin page `/admin/suggestions`
  (status, internal note, delete; new ones counted on the admin dashboard).
- **Dependencies, end to end**:
  - ticking a module ticks its dependencies for real (cart and purchase window), locked while needed;
    a dependency only counts as satisfied when **paid** (a trial one would lapse under its dependents);
  - **a dependency always outlasts its dependents**: `BillingService.plan()` (shared by `POST /billing/quote` and the real
    purchase, so the amount shown is the amount charged) extends a shorter dependency by whole months and bills it;
  - auto-renew cascades (on for a module = on for its dependencies; off for a dependency = off for its dependents), and a
    renewal also pays the extension of the dependencies it sits on;
  - `ModuleEntitlementGuard` pauses a self-service module (has an end date) whose dependency lapsed (402 with `requires`),
    admin grants and trials are exempt so the admin "force" keeps working; the license `ent` list mirrors this.
- **UI**: locked modules are obvious without hover (permanent "Debloquer" pill in the sidebar, grey tiles with their
  call to action); "Prolonger" only for a really bought module (a trial or unowned module says "Acheter"); no more
  "/ 3 mois" on module cards; packs list the same modules on the same rows (not included = greyed) with the check on the
  same line; remaining time reads "6 mois et 14 j" instead of "196 j".
- **Blank page fix**: after a deploy an open tab asked for page files that no longer existed and nginx answered with
  `index.html` (200), so the lazy page failed to load and React unmounted everything. Now: a real 404 for missing
  `/assets/*` (immutable cache for hashed files, `no-cache` for `index.html`), a route error boundary (one automatic reload
  on a stale version, otherwise a message with a button and the technical detail), and a `vite:preloadError` reload.

Tests: API 16 suites / 113 tests (billing e2e now 23: quote = charge, dependency extension, server pause, cascade,
renewal covering dependencies, sites quota, suggestions; admin e2e triages a suggestion), web 10 tests.

## Round 3

- **Screens no longer offer what another inactive module would provide** (`useHasModule()`): Caisse hides the
  product field without Stock (and the client / bon pickers without Factures / Ventes+Achats), Ventes and Factures fall
  back to service-only lines without Stock (and Ventes hides bons de livraison, retours and tarifs négociés), Stock hides
  lot tracking without Qualité and the supplier/client pickers without Factures, Scan hides "Réception rapide" without
  Achats and skips lot / negotiated-price lookups without Qualité / Ventes, Sites hides transfers without Stock,
  Statistiques only shows the watch cards of active modules. Cross-module loads are tolerant (a refused request no longer
  fails the whole page).
- Multi-sites purchase: the stepper reads "+1", "+2"... (extra sites).
- Subscription invoices (Espace client) use a dedicated compact A5 layout with the customer's email and no
  "reste à payer"; the purchase window shows the duration first; remaining time reads "6 mois et 14 j".
- Favicon / app icons generated from the brand mark (`favicon.svg`, `.ico`, 16/32/48 png, apple-touch, 192/512, `site.webmanifest`).

## Round 4: balance system removed

- No more prepaid balance: `Organization.creditBalance` and `PlatformPayment.creditUsed` are dropped
  (migration `20261106200000_remove_credit_balance`), `POST /billing/credit` and `payWith` are gone, the
  "Solde & renouvellement" tab and the "pay with balance" option too.
- A purchase and an automatic renewal are recorded as offered ("paiement en ligne à venir"); the payment API
  plugs in at `BillingService.purchase` and `runRenewals`. Old `topup` payments stay in history as "Ancien rechargement".
- Deploy: this migration must be applied to the 4 databases before rebuilding `api`.

## Operational notes

- **The secondary test databases must be seeded**, not only migrated
  (`DATABASE_URL=…/stockily_test npx prisma db seed --schema packages/infra-db/prisma/schema.prisma`,
  same for `stockily_invoicing_test` / `_dev`) — otherwise `cash`, `stats`, `members`
  and `licensing` are missing and the admin/members/licensing e2e fail with 404/403.
- `/api/auth/*` is throttled to 5 req/min **per IP**, and every full page load
  calls `/auth/refresh`: reloading a page more than 5 times a minute logs the user
  out. Pre-existing; worth raising the refresh limit separately.
- Deploy: migration (all 4 databases) + rebuild `web` and `api`.

## Round 5: automatic renewal removed, Chargily Pay (test mode)

- Auto-renew removed (`autoRenew` column dropped, `PATCH /billing/auto-renew`, scheduler now only marks lapsed periods `expired`).
  A module is extended by buying more months (they stack after the current end).
- **Chargily Pay v2** (`chargily.service.ts`), customers and checkouts only (no products / prices):
  `CHARGILY_SECRET_KEY` (`test_sk_...` = test API `pay.chargily.net/test/api/v2`, `live_sk_...` = live) and `PUBLIC_APP_URL` in `.env` / compose.
  Unset key = purchases are "offered" as before.
- Flow: `POST /billing/purchase` creates a **pending** `platform_payments` row (+ `request` to replay) and a checkout for exactly the quoted amount
  (customer created once per org, `Organization.chargilyCustomerId`, our org id in `metadata.stockily_org_id`, payment id in the checkout metadata);
  the web redirects to `checkoutUrl`. Modules are activated, and the invoice number allocated, only when
  `POST /billing/webhook` (HMAC-SHA256 of the raw body, header `signature`, `rawBody: true` in `main.ts`) says `checkout.paid`, or when the customer
  comes back (`/compte?tab=payments&pay=<id>` -> `POST /billing/payments/:id/sync` asks Chargily). Idempotent (only a still-pending payment is settled).
- Migrations `20261106210000_remove_auto_renew`, `20261106220000_chargily_pay` (apply to the 4 databases).
