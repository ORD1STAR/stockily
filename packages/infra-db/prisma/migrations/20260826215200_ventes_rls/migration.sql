-- Milestone 10 (Gestion Ventes) — RLS for the 3 new orgId-bearing tables.
-- Milestone 8's ALTER DEFAULT PRIVILEGES already covers table-level GRANTs
-- for stockily_app automatically; ENABLE/FORCE ROW LEVEL SECURITY and the
-- policies themselves are not automatic per new table — same pattern as
-- purchasing_rls.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_orders', 'sales_order_counters', 'partner_product_prices']
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

-- Child table with no orgId of its own — scoped via its parent, same
-- pattern as purchase_order_lines.
ALTER TABLE sales_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales_order_lines
  USING (EXISTS (
    SELECT 1 FROM sales_orders so WHERE so.id = sales_order_lines."salesOrderId" AND so."orgId" = current_setting('app.tenant_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM sales_orders so WHERE so.id = sales_order_lines."salesOrderId" AND so."orgId" = current_setting('app.tenant_id', true)
  ));
