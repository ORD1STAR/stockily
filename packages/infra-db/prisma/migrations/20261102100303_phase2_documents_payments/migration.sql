-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "fromDocuments" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'invoice';

-- AlterTable
ALTER TABLE "purchase_receipt_lines" ADD COLUMN     "discountPercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "purchase_receipts" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "number" TEXT,
ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "sales_order_lines" ADD COLUMN     "quantityDelivered" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "trade_documents" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "partnerId" TEXT,
    "salesOrderId" TEXT,
    "invoiceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'validated',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdBy" TEXT,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "trade_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_document_lines" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discountPercent" DECIMAL(5,2),
    "taxRateId" TEXT,
    "salesOrderLineId" TEXT,

    CONSTRAINT "trade_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_counters" (
    "orgId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "docType" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_counters_pkey" PRIMARY KEY ("orgId","year","docType")
);

-- CreateTable
CREATE TABLE "partner_payments" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "documentType" TEXT,
    "documentId" TEXT,
    "createdBy" TEXT,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "partner_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trade_documents_orgId_type_idx" ON "trade_documents"("orgId", "type");

-- CreateIndex
CREATE INDEX "trade_documents_partnerId_idx" ON "trade_documents"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "trade_documents_orgId_number_key" ON "trade_documents"("orgId", "number");

-- CreateIndex
CREATE INDEX "partner_payments_orgId_idx" ON "partner_payments"("orgId");

-- CreateIndex
CREATE INDEX "partner_payments_partnerId_idx" ON "partner_payments"("partnerId");

-- CreateIndex
CREATE INDEX "partner_payments_documentId_idx" ON "partner_payments"("documentId");

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_documents" ADD CONSTRAINT "trade_documents_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_documents" ADD CONSTRAINT "trade_documents_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_documents" ADD CONSTRAINT "trade_documents_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_documents" ADD CONSTRAINT "trade_documents_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_documents" ADD CONSTRAINT "trade_documents_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_document_lines" ADD CONSTRAINT "trade_document_lines_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "trade_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_document_lines" ADD CONSTRAINT "trade_document_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_document_lines" ADD CONSTRAINT "trade_document_lines_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_document_lines" ADD CONSTRAINT "trade_document_lines_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "sales_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payments" ADD CONSTRAINT "partner_payments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payments" ADD CONSTRAINT "partner_payments_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────── Row-Level Security (same tenant_isolation pattern as purchasing_rls / ventes_rls) ─────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trade_documents', 'document_counters', 'partner_payments']
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

ALTER TABLE trade_document_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_document_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON trade_document_lines
  USING (EXISTS (
    SELECT 1 FROM trade_documents d WHERE d.id = trade_document_lines."documentId" AND d."orgId" = current_setting('app.tenant_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM trade_documents d WHERE d.id = trade_document_lines."documentId" AND d."orgId" = current_setting('app.tenant_id', true)
  ));

GRANT ALL PRIVILEGES ON trade_documents, trade_document_lines, document_counters, partner_payments TO stockily_app;

-- ───────── Backfill ─────────
-- Supplier invoices created from a BC duplicate the value of its réceptions,
-- which now count in the supplier balance themselves.
UPDATE "invoices" SET "fromDocuments" = true WHERE "type" = 'SUPPLIER' AND "purchaseOrderId" IS NOT NULL;

-- Existing réceptions take their supplier from their BC.
UPDATE "purchase_receipts" r SET "supplierId" = po."supplierId"
FROM "purchase_orders" po WHERE r."purchaseOrderId" = po.id AND r."supplierId" IS NULL;

-- Existing réceptions get a BR-YYYY-NNNNNN number, in reception order per org and year.
WITH numbered AS (
  SELECT id, "orgId", EXTRACT(YEAR FROM "receivedAt")::int AS yr,
         ROW_NUMBER() OVER (PARTITION BY "orgId", EXTRACT(YEAR FROM "receivedAt") ORDER BY "receivedAt", id) AS n
  FROM "purchase_receipts" WHERE "number" IS NULL
)
UPDATE "purchase_receipts" r
SET "number" = 'BR-' || numbered.yr || '-' || LPAD(numbered.n::text, 6, '0')
FROM numbered WHERE r.id = numbered.id;

INSERT INTO "document_counters" ("orgId", "year", "docType", "lastNumber")
SELECT "orgId", EXTRACT(YEAR FROM "receivedAt")::int, 'receipt', COUNT(*)
FROM "purchase_receipts" GROUP BY "orgId", EXTRACT(YEAR FROM "receivedAt");
