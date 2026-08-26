-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "salesOrderLineId" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "salesOrderId" TEXT;

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "paymentTermsNetDays" INTEGER;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "comparisonGroupId" TEXT;

-- AlterTable
ALTER TABLE "purchase_receipt_lines" ADD COLUMN     "landedCostShare" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "purchase_receipts" ADD COLUMN     "landedCostAmount" DECIMAL(14,2),
ADD COLUMN     "landedCostNotes" TEXT;

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'quote',
    "number" TEXT,
    "promotedFromQuoteNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "expectedDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_counters" (
    "orgId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "docType" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_order_counters_pkey" PRIMARY KEY ("orgId","year","docType")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantityOrdered" DECIMAL(14,3) NOT NULL,
    "quantityInvoiced" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discountPercent" DECIMAL(5,2),
    "taxRateId" TEXT,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_product_prices" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,2),
    "discountPercent" DECIMAL(5,2),
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),

    CONSTRAINT "partner_product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_orders_orgId_idx" ON "sales_orders"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_orgId_number_key" ON "sales_orders"("orgId", "number");

-- CreateIndex
CREATE INDEX "partner_product_prices_orgId_idx" ON "partner_product_prices"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_product_prices_orgId_partnerId_productId_key" ON "partner_product_prices"("orgId", "partnerId", "productId");

-- CreateIndex
CREATE INDEX "purchase_orders_comparisonGroupId_idx" ON "purchase_orders"("comparisonGroupId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "sales_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_counters" ADD CONSTRAINT "sales_order_counters_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_product_prices" ADD CONSTRAINT "partner_product_prices_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_product_prices" ADD CONSTRAINT "partner_product_prices_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_product_prices" ADD CONSTRAINT "partner_product_prices_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
