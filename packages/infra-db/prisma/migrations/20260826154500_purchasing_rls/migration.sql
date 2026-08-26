-- Milestone 9 (Achats) — RLS for the 5 new tables. Milestone 8's
-- ALTER DEFAULT PRIVILEGES already covers table-level GRANTs for
-- stockily_app automatically (see 20260826090000_enable_row_level_security),
-- but ENABLE/FORCE ROW LEVEL SECURITY and the policies themselves are not
-- automatic per new table — same pattern as every table added there,
-- applied here for the tables this milestone introduces.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_orders', 'purchase_order_counters', 'purchase_receipts']
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

-- Child tables with no orgId of their own — scoped via their parent, same
-- pattern as stock_levels/invoice_lines/payments/invoice_reminders.
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order_lines
  USING (EXISTS (
    SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_lines."purchaseOrderId" AND po."orgId" = current_setting('app.tenant_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_lines."purchaseOrderId" AND po."orgId" = current_setting('app.tenant_id', true)
  ));

ALTER TABLE purchase_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receipt_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_receipt_lines
  USING (EXISTS (
    SELECT 1 FROM purchase_receipts pr WHERE pr.id = purchase_receipt_lines."receiptId" AND pr."orgId" = current_setting('app.tenant_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM purchase_receipts pr WHERE pr.id = purchase_receipt_lines."receiptId" AND pr."orgId" = current_setting('app.tenant_id', true)
  ));
