# Milestone 12 — Platform admin, sub-users, flexible login, licensing hardening

Four things, all on the shared codebase (so they apply **both online and in
the offline desktop app**, except the admin console which is server-only).
Approved plan: `~/.claude/plans/transient-scribbling-glacier.md`.

## A. Login with email OR username

`User` gained `username` (globally unique, nullable), `displayName`,
`isActive`, `createdById`; `email` is now nullable (a sub-user may have none).
`auth.service.ts` resolves the login `identifier` against both columns
(`findFirst … OR [{email insensitive},{username}]`), rejects inactive users,
and keeps the same generic error. `LoginDto` accepts `identifier` **or**
legacy `email` (the desktop activation login still sends `email`). Web login
field relabelled "Email ou nom d'utilisateur".

## B. Sub-users with scoped access (org-side)

New `members` module (`members.user.manage`, Super Admin / Gestionnaire
only). An owner creates sub-users (username + password) and picks, per
module, **view or edit**, plus a **site scope** (all sites, or specific
sites). This is materialised onto the existing primitives — a custom
org-scoped `Role` per sub-user holding the mapped `RolePermission` rows, and
`UserRole` rows per site — so the whole guard chain works unchanged. Editing
access / password / active revokes live sessions.

- **Guard fix** (`permission.guard.ts`): a route with no `siteId` now passes
  for *any* of the user's roles, not only org-wide ones — otherwise a purely
  site-scoped sub-user was locked out of every list route (e.g. `GET
  /counters`). The service layer scopes which rows they then receive.
- **Counters** now actually filter by the caller's accessible sites
  (`SiteAccessService`), so a caissier scoped to one dépôt sees only that
  dépôt's comptoirs — the "specific comptoirs" grain, at site level.
- `/me` now returns `permissions[]` + `siteScope`; the web has a `can()`
  helper, a gated **Utilisateurs** page (`MembersPage`), and shows
  username/displayName where a user has no email.
- Per-individual-comptoir grants are a deliberate follow-up (not built).

## C. Platform-admin console (server-only, cross-tenant)

A separate admin identity and surface for Ordi-Tech, distinct from a per-org
Super Admin. **Registered only when not in local mode** — a device never
exposes it.

- **Cross-tenant access**: `AdminPrismaService` connects as the `stockily`
  superuser (bypasses RLS) — the normal RLS client returns zero rows with no
  tenant set, so a cross-tenant console is impossible through it. The new
  admin tables (`AdminUser`, `AdminRefreshToken`, `AdminAuditLog`,
  `ModulePrice`, `PlatformPayment`) are RLS **deny-all** for the restricted
  app role, so only the superuser client touches them.
- **Auth**: separate `/admin/auth/{login,refresh,logout}`, a
  `platform-admin` JWT (`AdminAuthGuard`), separate refresh tokens. The
  tenant `JwtAuthGuard` now rejects admin tokens (no `orgId` / `typ` set) and
  vice-versa. First admin via `scripts/create-admin.mjs`.
- **Features**: dashboard (orgs / users / devices / module adoption);
  organizations list + detail; **activate/suspend/cancel modules** with a
  dependency check (and a forced override) and a confirmation popup; seats
  per site; cross-tenant **user management** (reusing B's `MembersService`
  bound to the superuser client); device deactivate/revoke; **pricing** per
  module; **payments** list (empty until the payment API); merged
  cross-tenant **system logs** (`AuditLog` + `AdminAuditLog`); and the
  **SQL console** — read-only by default (a `SET TRANSACTION READ ONLY` tx
  with a statement timeout and a 1000-row cap, so Postgres itself blocks a
  stray write), with an explicit write mode that needs the typed phrase
  « JE CONFIRME » and logs every statement to `AdminAuditLog`. Every admin
  write is audited.
- **Web**: a self-contained `/admin/*` section with its own
  `AdminAuthProvider` (separate token, separate `localStorage` key) and shell
  — invisible to tenant users, unusable on a device (the `/admin` API 404s
  there).

## D. Licensing hardening (from the security assessment)

The assessment (MILESTONE_11 / the plan) found the casual-copy lock held but
a determined cracker could unlock all modules offline with one local
`UPDATE organization_module_entitlements`, because the guard read the device's
own database. **Fixed**: the signed RS256 license now carries the org's
entitled module keys (`ent`), and in local mode `ModuleEntitlementGuard`
trusts that signed list instead of the DB — so editing the local table
unlocks nothing (the signature can't be forged). Admin entitlement changes
reach a device at its next renew (token re-signed). The honest residual
(documented): enforcement still runs as JS, so a determined attacker can
patch the bundled code; the durable moat remains server-side + the business
model (cloud sync, backups, the owner's remote dashboard, updates) a frozen
cracked copy loses. Rust `Claims` carries `ent` for future use.

## Online vs. local

A, B, D are shared code → they work on the server **and** inside the desktop
app. The desktop bundle was re-staged so its runtime ships them. C is the
only server-only piece.

## How to verify

```bash
npx nx run-many -t lint typecheck build test --projects=web,api,domain-stock,infra-db
```
API suite **82/82 green** (adds `members.e2e`, `admin.e2e`,
`module-entitlement.local.spec`). Green except `@org/api:typecheck`'s known
e2e-spec `import()` quirk (now 8 of those, from the 2 new specs — same
non-bug). New e2e coverage:
- **members.e2e** — email+username login, site-scoped comptoir visibility,
  view-vs-edit 403, live access upgrade, deactivation.
- **admin.e2e** — admin login, cross-tenant org listing (where the normal
  client sees none), token cross-over blocked both ways, module grant +
  dependency block/force, SQL console (SELECT runs, read-only blocks a write,
  write needs confirmation and is audited, multi-statement refused),
  cross-tenant sub-user creation.
- **module-entitlement.local.spec** — in local mode the guard trusts the
  signed token and never touches the DB (a local INSERT can't add a module).

Also run live, not just built:
- **Desktop app e2e** (real Tauri build, re-staged runtime): activation →
  auto-login → Appareils → clean shutdown → relaunch on stored license →
  tampered-license → activation. All pass with A/B/D in the bundle.
- **Admin console browser smoke**: login → dashboard KPIs → organizations →
  org detail (modules/subscription, dependency hints) → SQL SELECT with
  results → write-mode confirmation box. All pass.

## Deploying (when ready)

API + web changes + 3 migrations (`user_username_identity`,
`user_email_nullable`, `platform_admin`) + reseed (adds the `members`
module). Then `node scripts/create-admin.mjs` on the server to make the first
platform admin. The admin console lives at `/admin` on the same domain.
