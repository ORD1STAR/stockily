-- Milestone 8 — Postgres Row-Level Security (RLS), flagged as a deliberate
-- gap since Milestone 1 (docs/Action Plan.md §2, docs/MILESTONE_6.md).
--
-- IMPORTANT — read before touching this file: Postgres superusers and
-- BYPASSRLS roles unconditionally bypass RLS, no matter what policies
-- exist (verified empirically against this project's own dev database
-- before writing this migration — the `stockily` role docker-compose.yml
-- creates via POSTGRES_USER is a superuser). So this migration also
-- creates a second, restricted, non-superuser role (`stockily_app`) that
-- the RUNNING API must connect as for RLS to mean anything — `stockily`
-- keeps being used for migrations/seed scripts (a trusted, non-request-path
-- tool that legitimately needs cross-tenant access by design, same as any
-- ordinary admin/migration account). See apps/api's new APP_DATABASE_URL
-- and docker-compose.yml/.env.example.

-- ---------------------------------------------------------------------------
-- 1. Restricted application role
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stockily_app') THEN
    -- Dev-only default password, same pattern as `stockily`/`stockily` in
    -- docker-compose.yml (README already documents that pair as dev-only —
    -- a real deployment must set both to real secrets).
    CREATE ROLE stockily_app LOGIN PASSWORD 'stockily_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO stockily_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO stockily_app;
-- So a future migration's new tables (e.g. Milestone 9's PurchaseOrder/
-- PurchaseReceipt) are automatically usable by stockily_app without a
-- repeat of this GRANT — RLS enable/policy statements themselves still
-- need to be added explicitly per new tenant-scoped table, this only
-- covers table-level privileges.
ALTER DEFAULT PRIVILEGES FOR ROLE stockily IN SCHEMA public GRANT ALL ON TABLES TO stockily_app;
ALTER DEFAULT PRIVILEGES FOR ROLE stockily IN SCHEMA public GRANT ALL ON SEQUENCES TO stockily_app;

-- ---------------------------------------------------------------------------
-- 2. organizations — self-referencing: the tenant boundary IS this table's
--    own id, not an orgId column. INSERT is intentionally unrestricted
--    (WITH CHECK true) — creating a brand-new org has no cross-tenant risk
--    (nothing existing is being read or modified); AuthService.signup sets
--    app.tenant_id to the new org's id immediately after creating it, before
--    creating the first User row, so every following statement in that same
--    transaction IS correctly scoped (see auth.service.ts).
-- ---------------------------------------------------------------------------

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_select ON organizations FOR SELECT
  USING (id = current_setting('app.tenant_id', true));
CREATE POLICY organizations_insert ON organizations FOR INSERT
  WITH CHECK (true);
CREATE POLICY organizations_update ON organizations FOR UPDATE
  USING (id = current_setting('app.tenant_id', true))
  WITH CHECK (id = current_setting('app.tenant_id', true));
CREATE POLICY organizations_delete ON organizations FOR DELETE
  USING (id = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------------
-- 3. modules — global reference data (all 13 module keys, same rows for
--    every org). Deliberately NOT tenant-scoped, no RLS — every org needs
--    to read the full registry to know what it can activate.
-- ---------------------------------------------------------------------------

-- (no RLS on `modules`, by design)

-- ---------------------------------------------------------------------------
-- 4. users / refresh_tokens — login, signup, and refresh all run BEFORE any
--    tenant context exists (there's no bearer JWT yet to derive orgId from),
--    and by design need a lookup that isn't scoped to one org (by email; by
--    raw token hash). So SELECT/INSERT here permit the "no context set yet"
--    case explicitly, in addition to the normal same-org case — the actual
--    security boundary for these two flows is "knows the right password" /
--    "presents the exact right token hash", not org scoping; RLS is
--    secondary defense for them, same as everywhere else, not the primary
--    one. UPDATE/DELETE stay strictly org-scoped (covers the
--    logout-everywhere path, which does run with a real access token).
-- ---------------------------------------------------------------------------

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_select ON users FOR SELECT
  USING (current_setting('app.tenant_id', true) IS NULL OR "orgId" = current_setting('app.tenant_id', true));
CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "orgId" = current_setting('app.tenant_id', true));
CREATE POLICY users_update ON users FOR UPDATE
  USING ("orgId" = current_setting('app.tenant_id', true))
  WITH CHECK ("orgId" = current_setting('app.tenant_id', true));
CREATE POLICY users_delete ON users FOR DELETE
  USING ("orgId" = current_setting('app.tenant_id', true));

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY refresh_tokens_all ON refresh_tokens
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = refresh_tokens."userId" AND u."orgId" = current_setting('app.tenant_id', true))
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NULL
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = refresh_tokens."userId" AND u."orgId" = current_setting('app.tenant_id', true))
  );

-- ---------------------------------------------------------------------------
-- 5. roles / role_permissions / user_roles — system-default roles have
--    orgId IS NULL (visible to every org, per schema.prisma's own comment);
--    a custom per-org role (none exist yet, but the column allows it) is
--    org-scoped normally. These are only ever read behind JwtAuthGuard
--    (PermissionGuard etc.), so a real tenant context always exists by the
--    time they're queried — no "unset context" carve-out needed here.
-- ---------------------------------------------------------------------------

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_isolation ON roles
  USING ("orgId" IS NULL OR "orgId" = current_setting('app.tenant_id', true))
  WITH CHECK ("orgId" IS NULL OR "orgId" = current_setting('app.tenant_id', true));

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_isolation ON role_permissions
  USING (EXISTS (
    SELECT 1 FROM roles r WHERE r.id = role_permissions."roleId"
    AND (r."orgId" IS NULL OR r."orgId" = current_setting('app.tenant_id', true))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM roles r WHERE r.id = role_permissions."roleId"
    AND (r."orgId" IS NULL OR r."orgId" = current_setting('app.tenant_id', true))
  ));

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY user_roles_isolation ON user_roles
  USING (EXISTS (
    SELECT 1 FROM users u WHERE u.id = user_roles."userId" AND u."orgId" = current_setting('app.tenant_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users u WHERE u.id = user_roles."userId" AND u."orgId" = current_setting('app.tenant_id', true)
  ));

-- ---------------------------------------------------------------------------
-- 6. Direct orgId tables — the common case, one identical policy shape.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organization_module_entitlements',
    'sites',
    'product_categories',
    'products',
    'stock_movements',
    'stock_transfers',
    'barcode_labels',
    'batches',
    'quality_checks',
    'non_conformities',
    'expiry_alerts',
    'tax_rates',
    'partners',
    'invoices',
    'invoice_counters',
    'audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("orgId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("orgId" = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 7. Child tables with no orgId of their own — scoped via their parent.
-- ---------------------------------------------------------------------------

ALTER TABLE stock_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_levels FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_levels_isolation ON stock_levels
  USING (EXISTS (
    SELECT 1 FROM products p WHERE p.id = stock_levels."productId" AND p."orgId" = current_setting('app.tenant_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM products p WHERE p.id = stock_levels."productId" AND p."orgId" = current_setting('app.tenant_id', true)
  ));

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoice_lines', 'payments', 'invoice_reminders']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = %I.%I AND i."orgId" = current_setting(''app.tenant_id'', true))) WITH CHECK (EXISTS (SELECT 1 FROM invoices i WHERE i.id = %I.%I AND i."orgId" = current_setting(''app.tenant_id'', true)))',
      t, t, 'invoiceId', t, 'invoiceId'
    );
  END LOOP;
END
$$;
