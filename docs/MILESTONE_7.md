# Milestone 7 — Live walkthrough fixes, Vente rapide, and mobile

Not a planned Action Plan milestone — this one started as "act as a real
grocery wholesaler and use the app end to end," found real bugs and gaps by
actually doing that, then kept going through several rounds of user-driven
fixes and two genuinely new features (a retail till mode, a mobile
experience). Grouped here by round, in the order it happened.

## Round 1 — Live walkthrough bug fixes

A full simulation as a fictional wholesaler (Grossiste El Wafa Alimentation:
yaourt, huile, fromage, lait, thon, eau, jus — 3 sites, 12 products) surfaced
six real bugs, all found by using the running app in Chrome, not by reading
code:

1. **A brand-new product was permanently invisible and unreceivable** —
   `GET /stock/products` mapped over each product's `stockLevels`, which
   don't exist until a first movement. Fixed by synthesizing a zero-quantity
   row per (product, site) with no ledger history yet.
2. **A lot marked "non conforme" at receiving never actually got
   quarantined** — Scan posted the quality check before the stock movement,
   so the quarantine calculation's ledger read saw zero units. Fixed by
   posting the movement first.
3. **An expired access token silently threw away in-progress work** —
   nothing refreshed it in the background. Fixed with silent-refresh-and-
   retry-once in `authedRequest`, concurrent 401s coalesced into one refresh.
4. **No way, anywhere, to create a VAT rate** — the endpoint existed, no UI
   called it. Added "+ Taux de TVA" next to "+ Nouveau client".
5. **Every invoice was capped at one line and never touched stock** — the
   backend already accepted an array of product-linked lines; the form
   built exactly one hardcoded free-text line. Rewrote it around a real
   line array with a product picker per line.
6. **An oversold invoice line showed a raw UUID** instead of naming the
   product — rebuilt the error message using the line's own description.

## Round 2 — Small fixes, tested one at a time

Per explicit instruction to fix and verify each one individually:

- Category creation silently duplicated a near-identical name (no
  uniqueness check) — fixed with a case-insensitive lookup before create.
- Scan's quantity field was a stepper with no way to type a number — added
  an editable numeric input (capped at available stock on sortie/transfert,
  uncapped on the pre-direction entrée step).
- Signup page had one leftover English string on an otherwise French UI.

## Round 3 — Fournisseurs, and a real supplier/customer on stock movements

- **Stock site filter didn't persist** across navigation — now backed by
  `localStorage`, with a safety reset if the persisted site no longer exists.
- **Fournisseurs & clients management** — Partner already modeled
  `isSupplier`, but the only creation path (Invoicing's "+ Nouveau client")
  hardcoded `isCustomer: true`. Added a full management modal reachable from
  the sidebar's Paramètres area (list, create, edit — a new
  `PATCH /invoicing/partners/:id`), and a partner picker (optional,
  defaults to unspecified) on Stock's movement form, Scan's entrée/sortie
  steps, and Invoicing's client field.
- **`stock_movements.partnerId`** — a new nullable FK (not folded into the
  existing `relatedEntityType`/`relatedEntityId` pair, so it can be
  joined/displayed directly like `batchId`) recording who a receipt came
  from or a sale went to; also set on invoice-driven OUT movements for the
  same ledger traceability.
- **AppShell layout fix**: the sidebar used to scroll away with a tall page
  instead of staying fixed — `.shell` and its two children now each get
  their own `100vh` scroll region.

## Round 4 — Vente rapide (Scan's checkout mode)

A shop needs to scan several items in a row for one customer and cut that
batch into a sale, not walk through Entrée/Sortie/Transfert per scan. Added
a third Scan mode: each scan appends a line to a running cart (rescanning
the same item bumps its quantity, capped at what's on hand); "Terminer la
vente" cuts the session into one CUSTOMER invoice, created and finalized
immediately via the same `createInvoice` + `finalizeInvoice` pair the
desktop Invoicing page already uses.

This needed a real gap filled first: **`Product.sellPrice`** (nullable,
distinct from the existing purchase-side `averageCost`/WAC) — there was no
sale price anywhere, so every invoice line's price had always been typed by
hand. Added it to product creation, a new editable control on the SKU
detail modal (a new `PATCH /stock/products/:id` — there was no product-edit
endpoint at all before this), and Scan resolution now returns it to
auto-fill (and still allow editing) each cart line's price.

**Payment defaults**: a till sale is paid on the spot — Vente rapide
defaults new sales to Payée (records a full payment right after finalize),
with a Payée/Non payée toggle for the exception (a tab, a delivery invoiced
now but collected later).

## Round 5 — Design pass, flexible payments, searchable pickers, real labels

Four fixes from one clarified complaint ("the Vente rapide product lines
are ugly") plus three requested alongside it:

- **Cart line redesign** — the actual complaint: cart lines reused the
  generic `.lot-mini-table`, cramming a long product name into a narrow
  column while qty/price/subtotal sat in a plain unstyled inputs. Rebuilt
  as stacked receipt-style rows.
- **Flexible invoice payments** — a "Marquer payée intégralement" one-click
  button, and a confirm-then-reset "Paiement erroné ? Annuler les
  paiements" action (`POST /invoicing/invoices/:id/payments/reset` deletes
  the payment rows and re-derives status back to unpaid) for a mistaken
  full/partial payment — without touching the invoice's own gapless
  compliance-numbered sequence, which must never be undone once finalized.
- **`SearchableSelect`** — a shared type-to-filter combobox, replacing
  plain `<select>` pickers for clients/fournisseurs/products across Stock's
  movement form, Invoicing's client and per-line product fields, and Scan's
  entrée/sortie/checkout pickers.
- **Real label PDFs** — "Imprimer" on a label used to only increment a
  printed counter; nothing was ever shown, printed, or scannable. Added
  `GET /scan/labels/:id/pdf`, a real barcode/QR image (via the new `bwip-js`
  dependency) laid out on a small label-sized PDF page with pdfkit — the
  same engine invoicing's own PDF export already uses. Real EAN13 needs a
  12–13 digit numeric GTIN, which this app's SKU/lot codes usually aren't,
  so a non-numeric code falls back to Code128 regardless of what
  `symbology` the label was tagged with.

## Round 6 — `api:typecheck` fix

`isolatedModules: true` (`tsconfig.base.json`) exists for the web app's
Vite/esbuild build, which transpiles file-by-file with no cross-file type
info. The API's actual build is full `tsc` (`webpack.config.js: compiler:
'tsc'`), which already has complete program knowledge and correctly keeps a
DTO class as a real import even when a decorated method only ever uses it
as a type annotation — exactly what `emitDecoratorMetadata` needs so
NestJS's `ValidationPipe` can reflect the real class at runtime. The
"obvious" fix (convert every flagged `import { CreateInvoiceDto } from ...`
to `import type`) would have silenced the diagnostic by erasing that import
at compile time — and then NestJS reflects `Object` instead of the DTO for
that parameter, silently disabling class-validator's checks on the request
body for every single endpoint. Overriding `isolatedModules: false` on the
API's own `tsconfig.app.json`/`tsconfig.spec.json` fixed the ~45 TS1272
errors with none of that risk, since nothing about the API's real build
needs the flag. Also fixed while it stopped masking them: a bare pdfkit
`openImage()` call (not in `@types/pdfkit` at all — reads a PNG's
width/height from its IHDR chunk directly instead), an env-driven JWT
`expiresIn` needing a cast to `ms`'s `StringValue`, and a nullable Prisma
`batchId` passed where `recordMovement` expects `undefined`.

Four errors remain, confined to the e2e specs' deliberate
`await import('./app/app.module')` pattern (used to override
`DATABASE_URL` before the module loads) — a narrower tsconfig
project-reference scoping issue, not a real behavioral bug (the specs
already pass), left alone rather than risk touching working tests.

## Round 7 — Org logo, and a mobile home screen

- **Org logo** — Paramètres du Business had one field literally labeled
  "(à venir)". Wired up for real: drag-drop or click to browse, resized/
  re-encoded to a small PNG `data:` URL client-side (a `<canvas>`, capped at
  240px — no object storage or multipart upload endpoint needed for what's
  a rare, low-volume write), stored on `Organization.logo`, with a preview
  and replace/remove. Now also printed on every invoice PDF next to the
  seller name, which the form's own subtitle had already promised
  ("Ces informations apparaissent sur toutes les factures émises") but
  never delivered for this specific field.
- **Mobile home screen** — on a narrow viewport, `/dashboard` renders
  `MobileHome` instead of the desktop org-summary dashboard: two cards
  (Applications, Scan / QR) plus the wordmark, org name, and logout that
  AppShell's sidebar otherwise carries. "Applications" opens a new `/apps`
  launcher (every entitled module as a tappable list, same
  `PHASE1_MODULES` source of truth AppShell's own sidebar now uses too).
  "Scan / QR" goes straight into Scan, which drops AppShell's 232px
  sidebar entirely on mobile — its own header comment had already
  anticipated exactly this ("a real Capacitor-wrapped build would drop
  AppShell entirely for this route") — replaced by a minimal top bar
  (back to home, logout), so all three Scan modes run genuinely full-screen
  on a phone instead of squeezed next to a sidebar with no room there.
  Detection is a real `window.innerWidth <= 800` check (matching
  `docs/Wireframes.html`'s own breakpoint) with a resize listener, not a
  user-agent sniff.

Deliberately out of scope: the other four module pages (Stock, Quality,
Invoicing, Sites) still render through AppShell's desktop sidebar on
mobile — only the landing screen and Scan itself were asked for.

## Round 8 — Real-device mobile pass: camera scanning, product barcodes, modal system

Round 7 shipped the mobile landing screen and Scan's own full-screen layout;
this round is what actually using both on a real iPhone (via Claude in
Chrome's remote-control bridge, not desktop devtools' viewport emulator)
turned up, plus closing the "deliberately out of scope" gap Round 7 left
open.

- **QR/barcode scanning never worked on the phone at all** — `cameraSupported`
  gated "Activer la caméra" on `'BarcodeDetector' in window` (Chrome's Shape
  Detection API), which Safari has never shipped on any platform. The button
  silently never rendered — no error, just no way to ever open the camera.
  Replaced with `@zxing/browser`, which drives `getUserMedia` and decoding
  itself against a plain `<video>`, so it works identically everywhere.
  Broadened detected formats to EAN-8/13, UPC-A/E, Code128/39 alongside QR
  (a "universal" scan was the actual ask, not QR-only).
- **The camera dropped after every single scan** — `IScannerControls.stop()`
  (the library's own high-level `decodeFromConstraints`/`decodeFromStream`)
  always tears down the underlying `getUserMedia` stream, not just the
  decode loop, so finishing an entrée/sortie/transfert and returning to the
  scan step meant a fresh permission round-trip and a re-tap on "Activer la
  caméra" every time. Fixed by splitting the two lifecycles: the stream is
  acquired once per page visit and kept alive in a ref; decoding is paused/
  resumed against that same stream via the library's lower-level `.scan()`
  method, which — called without its optional `finalizeCallback` — stops the
  decode loop without touching the stream. The `<video>` element is now
  always mounted (shared between Scanner and Vente rapide, shown/hidden via
  CSS) instead of unmounting per step, which is what made this safe. The
  camera now only fully releases on unmount (leaving Scan, refreshing, or
  logging out) — it stays live for the rest of the session otherwise.
  Vente rapide's continuous scanning also got the same treatment plus a
  1.5s same-code debounce (a still-visible barcode shouldn't re-add on
  every frame). Scan-attempt delay tuned from the library's 500ms default
  down to 80ms, and camera resolution capped at 1280x720 (down from
  whatever the phone's native resolution was) — both were making scanning
  feel sluggish independent of the above bug.
- **Product.barcode** — a new nullable field (distinct from `sku`, and from
  `BarcodeLabel`'s Stockily-generated codes) holding a product's own
  real-world manufacturer barcode. `Scan.resolveCode` now checks it as a
  fallback before SKU, so a box's existing barcode resolves immediately with
  no label-generation step first. Editable on the product create/edit forms,
  including a camera-scan button (same one-shot `.scan()` pattern as above)
  so registering it doesn't mean typing a 13-digit number by hand. Enforced
  unique per org, with a friendly conflict message instead of a raw P2002.
- **`isLotTracked` made editable after creation** — was structurally
  excluded from `UpdateProductDto` ("cascading implications once batches
  exist"), but grepping domain-stock and domain-quality confirms nothing
  actually reads it to gate any business logic — it's a display flag only.
  The real, common case it blocked: a product created with "Suivi par lot"
  left off by mistake, with no way to turn it back on. Now editable, guarded
  only against *disabling* it once the product already has batches (would
  orphan them from the UI that shows them) — enabling has no such risk and
  is never blocked.
- **AppShell goes fully responsive** — closes Round 7's "deliberately out of
  scope" gap. Below 800px the persistent 232px sidebar (previously
  unconditional — over half of a 375-430px screen) becomes an off-canvas
  drawer: closed by default, opened via a hamburger in a sticky top bar,
  closing again on any tap inside it. Since Paramètres du Business and
  Fournisseurs & clients no longer make sense buried at the bottom of a
  drawer only reachable from inside some other module, they got their own
  tiles on the Applications launcher (under a "Gestion" group) instead, with
  a "← Toutes les applications" link added to the drawer itself so a user
  already inside a module can still get back to that launcher.
- **Modal system redesign** — the bare absolutely-positioned "✕" (used
  identically across all 17 modals in the app) is now a sticky header (title
  + a proper circular close button) that stays visible through arbitrarily
  long scrolled content instead of disappearing past the first screen. On
  mobile, modals present as bottom sheets (rounded top corners, near-full
  height) sized with `dvh` rather than `vh` — `vh` measures the *largest*
  possible viewport (Safari's address bar fully collapsed) and doesn't
  shrink back when the address bar re-expands, which was letting the sheet's
  top edge (and its close button) render underneath the browser's own chrome.
- **Horizontal overflow, app-wide** — several `flex`/`grid` rows (action-
  button rows, the manual barcode-entry forms, the Scanner/Vente rapide/
  Étiquettes toggle) forced content wider than the screen because a flex/
  grid item's default `min-width` is its own unshrunk content size, not 0.
  Fixed at each source (`min-width: 0` + `flex-wrap` where it matters) plus
  a page-level `overflow-x: hidden` safety net. Also: mobile Safari/Chrome
  auto-zoom the whole page when a focused input's font-size is under 16px —
  every field here was smaller than that — fixed with a mobile-scoped
  `font-size: 16px !important` override.
- **Edge-swipe-back mitigation** — iOS Safari's edge-swipe "go back" gesture
  is recognized below the page's own DOM, so there's no CSS property to turn
  it off. Added the standard JS mitigation (watch for a touch starting near
  the screen edge that then moves mostly horizontally, `preventDefault()` on
  that `touchmove` early enough that WebKit's gesture recognizer defers to
  the page) — not a guarantee, since the actual gesture recognition happens
  outside what a page can fully control, so it needs verifying on a real
  device rather than by reading the code.
- **Web bundle split by route** — a `React.lazy()` per page instead of one
  ~850KB bundle every visitor downloaded just to see the login screen. Stock
  and Scan (the only two pages pulling in `@zxing/browser`) now isolate that
  ~480KB dependency into its own chunk. Main entry chunk: ~857KB → ~238KB.

## New backend surface added this milestone

- `PATCH /invoicing/partners/:id`, `POST /invoicing/invoices/:id/payments/reset`
- `PATCH /stock/products/:id` (Round 7: sellPrice; Round 8: barcode, isLotTracked)
- `GET /scan/labels/:id/pdf`
- `stock_movements.partnerId`, `products.sellPrice`, `organizations.logo`,
  `products.barcode` (four migrations — see "Multi-database migrations" below)

## How to verify

```bash
npx nx run-many -t lint typecheck build test --projects=web,api,domain-stock,infra-db
npx nx serve api   # :3000/api
npx nx serve web   # :4200
```
Full suite green (51 api tests, 15+1 domain tests) except `@org/api:typecheck`'s
four known e2e-spec errors (see Round 6). Everything in this milestone was
also exercised live in Chrome, not just built: a fournisseur created and
attributed on a real receipt, a multi-item Vente rapide sale (paid and
unpaid) that correctly deducted stock and created a real invoice, a payment
marked fully paid then reset, a label PDF fetched and its barcode confirmed
scannable-shaped, an org logo uploaded and confirmed rendering on a real
invoice PDF, and the mobile home → apps launcher → Scan full-screen flow
(viewport forced via `window.innerWidth` override + a dispatched `resize`
event, since this environment's browser-automation tool cannot resize the
real OS window — the underlying `useIsMobile` hook itself needs no such
workaround on a real device).

Round 8 had that real device this time — Claude in Chrome connected to an
actual iPhone (Safari), not devtools' viewport emulator — which is
specifically how the BarcodeDetector/Safari gap and the address-bar/`dvh`
issue were ever found at all; neither reproduces in a desktop viewport
emulation. Every fix in that round was deployed to `stockily.ordi-tech.com`
(a live HTTPS host reachable from the phone, reverse-proxied to the same
`docker-compose.yml` containers as local dev — see CLAUDE.md for exact
deploy commands) and re-verified there after each change, not just built.
Two things that *can't* be verified this way, flagged rather than guessed
at: actual scan speed/decode correctness (this environment has no real
camera hardware attached to it — confirmed via `enumerateDevices` — so
camera activation was verified up to `getUserMedia` being reached
correctly, not an actual successful decode), and the edge-swipe mitigation
(gesture recognition happens below the page, outside what remote
automation can trigger the same way a real thumb does).

## Multi-database migrations — a recurring gotcha this milestone

`npm run prisma:migrate` only ever applies to the database named in the
root `.env` (`stockily`). Three more databases exist and are **not** kept in
sync by that command: `stockily_test` and `stockily_invoicing_test` (hardcoded
connection strings at the top of `apps/api/src/*.e2e.spec.ts`, overriding
`DATABASE_URL` before the app module loads) and `stockily_invoicing_dev`. Every
schema change this milestone needed a manual follow-up:
```bash
for db in stockily_test stockily_invoicing_test stockily_invoicing_dev; do
  DATABASE_URL="postgresql://stockily:stockily@localhost:5432/${db}?schema=public" \
    npx prisma migrate deploy --schema packages/infra-db/prisma/schema.prisma
done
```
Forgetting this doesn't fail loudly at migration time — it surfaces later as
a confusing `PrismaClientKnownRequestError: column ... does not exist` the
next time `nx test api` (or anything hitting those DBs) runs. Worth a real
fix (a single `db:migrate:all` script) for whoever picks this up next.

## Other operational notes

- On Windows, a running `nx serve api` process holds a lock on
  `node_modules/.prisma/client/query_engine-windows.dll.node` — `prisma
  migrate dev`'s own `generate` step fails with `EPERM` if it's still
  running. Stop the dev server (or whatever's listening on :3000) before
  migrating, then restart it.
- `bwip-js` is a new root dependency (barcode/QR rendering, Round 5) —
  already in `package.json`, no further setup needed.
