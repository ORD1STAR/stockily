# Milestone 1 — Platform Bootstrap

Implements Action Plan §7 Milestone 1: org signup/login/JWT+refresh, the full
RBAC + entitlement guard chain, the module registry seeded with all 13
module keys, `audit_log` infrastructure, and a React app shell wired to the
real backend. Bare skeleton scope per the plan — no Stock/Quality/Invoicing
business logic yet; that's Milestone 2 onward.

## What's here

**Database** (`packages/infra-db`)
- `schema.prisma`: all Phase 1 tables from Action Plan §2–§3, plus two
  additions this milestone needed that weren't in the original skeleton:
  `OrganizationModuleEntitlement.trialEndsAt` (15-day trial mechanics, §11)
  and `RefreshToken.expiresAt` (an absolute expiry — the skeleton only had
  `revokedAt`).
- `prisma/seed.ts`: seeds all 13 modules (5 real, 8 phase-2/3 stubs) and the
  5 system roles with a default permission set. Idempotent — safe to re-run.
  Documents a few decisions the plan didn't pin down (see "Decisions made
  here" below).

**Backend** (`apps/api`)
- `AuthModule`: `POST /auth/{signup,login,refresh,logout,logout-everywhere}`.
- `TenancyModule`: the guard chain — `JwtAuthGuard → ModuleEntitlementGuard →
  PermissionGuard → SiteScopeGuard`, in that order, per §4. `GET /me` and a
  **temporary** `GET /demo/stock-access/:siteId` demonstrate it end-to-end;
  the latter should be deleted once real Sites-module endpoints exist.
- `AuditModule`: a real interceptor writing `audit_log` rows, wired onto
  signup as the one working example this milestone.

**Frontend** (`apps/web`)
- Signup/login pages, an auth context handling token storage and silent
  refresh, and a protected dashboard rendering the real `GET /me` response.

## Decisions made here (not already pinned down by the Action Plan)

1. **Password hashing: bcryptjs**, not native bcrypt/argon2 — pure JS, no
   node-gyp/build-toolchain requirement for local dev on Windows. Refresh
   tokens use a plain SHA-256 hash instead (high-entropy random bytes, not a
   password — bcrypt's slow KDF buys nothing there).
2. **JWT access TTL 15m, refresh TTL 30d** (`.env.example`) — reasonable
   defaults, not specified in the plan; change via `JWT_ACCESS_TTL` /
   `JWT_REFRESH_TTL_DAYS`.
3. **Scan module depends on Stock**, by extension of the plan's own logic for
   Quality ("a scan just calls `POST /stock-movements`" — meaningless
   without Stock), not something the plan stated explicitly. Phase 2/3
   module dependencies in the seed are provisional stubs, not designs.
4. **Super Admin vs. Gestionnaire**: identical `RolePermission` sets on the 5
   Phase 1 modules. What actually distinguishes them — subscription/module
   activation/user management — has no corresponding "module" in the
   13-module registry, so Milestone 1 doesn't model it as a permission at
   all. Revisit if that needs to become a real, checked distinction before
   it matters (nothing in this milestone enforces Super-Admin-only actions
   yet).
5. **Entitlement cache: in-memory, 30s TTL**, explicitly not Redis yet
   (single-instance deployment, per the plan's own §8 risk #4 resolution).
   Manually verified the cache correctly reflects a DB-level entitlement
   change once the TTL lapses, not just on a cold miss.
6. **Test DB strategy**: a real separate `stockily_test` database (same
   docker-compose Postgres, different DB name), prepared by
   `npm run test:e2e:db:setup` — not an in-memory/mocked Prisma client. This
   milestone *is* the tenancy/permission logic; mocking the DB away would
   test nothing meaningful about it. Test data uses a unique email per run
   rather than truncating between runs, to keep the setup simple.
7. **Frontend token storage**: only the refresh token persists
   (`localStorage`); the access token lives in memory only and is re-derived
   via silent refresh on every page load, rather than persisting a
   short-lived token that would usually be stale on reload anyway.

## Flagged separately (a real finding, not a footnote)

A previous scaffolding pass left an auto-generated `.claude/settings.json`
that silently auto-enabled a third-party Claude Code plugin sourced from
GitHub and loosened the sandbox's network policy — removed at the time,
per project memory. This milestone re-checked for the same pattern (any
scaffolding tool re-introducing an agent-config file with trust/permission
implications) and found nothing new to flag.

## How to run it

```bash
docker compose up -d                    # Postgres
npm install
cp .env.example .env                    # JWT_SECRET etc. for the API; the Prisma CLI
                                         # also reads this same root .env (see Milestone 2 note:
                                         # a second copy at packages/infra-db/prisma/.env
                                         # conflicts with this one — don't create it)
npm run prisma:migrate
npm run db:seed
npx nx serve api                        # http://localhost:3000/api
npx nx serve web                        # http://localhost:4200
```

To run the tests:

```bash
npx nx test api                         # unit tests + the real e2e test
npx nx test web
npm run test:e2e:db:setup               # one-time: prepares stockily_test
                                         # (re-run after a schema change)
```

## Verification performed

- `npx nx run-many -t lint build test` — clean across all 9 projects (7
  pre-existing lint warnings are `no-explicit-any` on mocked Prisma objects
  in test files, not a real issue).
- Manually smoke-tested the full auth flow against the live docker-compose
  Postgres with curl: signup → login → `GET /me` → wrong-password rejection
  → refresh rotation → replay-of-old-token rejection → logout-everywhere →
  a refresh token that was live at that moment now rejected → the
  still-short-lived access token itself keeps working until its own expiry
  (by design). Also manually expired an entitlement directly in the
  database mid-test to confirm `ModuleEntitlementGuard` returns 402 once its
  cache entry lapses, not just that it returns 200 when things are fine.
- Frontend: production build succeeds, the redirect-to-login test passes,
  and the real Vite dev server was confirmed serving/transforming correctly
  via curl. Full interactive browser click-through was not performed — no
  browser automation tool was available in this session.
