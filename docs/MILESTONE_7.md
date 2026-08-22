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

One item was investigated and explicitly left unresolved rather than
guessed at: an unexplained 3-unit stock exit with no matching action, no
batch reference, and no reproducible cause after two investigation passes.

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

## New backend surface added this milestone

- `PATCH /invoicing/partners/:id`, `POST /invoicing/invoices/:id/payments/reset`
- `PATCH /stock/products/:id`
- `GET /scan/labels/:id/pdf`
- `stock_movements.partnerId`, `products.sellPrice`, `organizations.logo`
  (three migrations — see "Multi-database migrations" below)

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
