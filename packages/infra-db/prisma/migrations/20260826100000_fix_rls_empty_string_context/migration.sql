-- Follow-up to 20260826090000_enable_row_level_security — a real bug found
-- by actually running the app's e2e suite against the restricted role, not
-- by reasoning about the SQL alone: `current_setting('app.tenant_id', true)`
-- does NOT reliably return NULL for "never set on this session." Once
-- ANY transaction on a given pooled connection has called
-- `set_config('app.tenant_id', ..., true)` (LOCAL), a later statement on
-- that SAME physical connection with no active LOCAL override sees an EMPTY
-- STRING (`''`), not NULL — confirmed by adding a temporary debug query
-- ($queryRaw`SELECT current_setting(...)`) right before the failing
-- `refresh_tokens` insert during signup and observing `v: ""`. Every policy
-- below that permits "no tenant context yet" (signup/login/refresh, which
-- run with no bearer JWT, so TenantContextMiddleware never sets one) was
-- written as `current_setting(...) IS NULL OR ...`, which this connection-
-- reuse behavior can silently defeat: `'' IS NULL` is false, so the
-- permissive branch never triggers once a connection has been "touched",
-- and the strict branch also fails (no row's orgId equals `''`) — the
-- policy ends up denying everything, not permitting too much (fails closed,
-- not open — this was caught by a legitimate signup/login/refresh breaking,
-- not a security leak), but breaks exactly those three pre-auth flows.
--
-- Fix: treat NULL and '' as the same "unset" state via `NULLIF(..., '')`.
-- `organizations`' own policies deliberately do NOT need this same fix —
-- see auth.service.ts's signup, which sets tenant context explicitly via an
-- app-generated id before the org even exists, rather than relying on an
-- "unset context" carve-out on that table at all.

DROP POLICY users_select ON users;
CREATE POLICY users_select ON users FOR SELECT
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR "orgId" = current_setting('app.tenant_id', true));

DROP POLICY users_insert ON users;
CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR "orgId" = current_setting('app.tenant_id', true));

DROP POLICY refresh_tokens_all ON refresh_tokens;
CREATE POLICY refresh_tokens_all ON refresh_tokens
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = refresh_tokens."userId" AND u."orgId" = current_setting('app.tenant_id', true))
  )
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = refresh_tokens."userId" AND u."orgId" = current_setting('app.tenant_id', true))
  );
