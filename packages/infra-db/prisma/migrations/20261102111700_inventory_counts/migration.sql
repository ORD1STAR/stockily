-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "inventoryReminder" TEXT NOT NULL DEFAULT 'off',
ADD COLUMN     "inventoryReminderLastSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "inventory_counts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scope" TEXT NOT NULL DEFAULT 'all',
    "categoryId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),
    "validatedBy" TEXT,

    CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_lines" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "systemQty" DECIMAL(14,3) NOT NULL,
    "countedQty" DECIMAL(14,3),
    "unitCost" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "inventory_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_counts_orgId_siteId_idx" ON "inventory_counts"("orgId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_counts_orgId_number_key" ON "inventory_counts"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_lines_countId_productId_key" ON "inventory_count_lines"("countId", "productId");

-- AddForeignKey
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_countId_fkey" FOREIGN KEY ("countId") REFERENCES "inventory_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────── Row-Level Security ─────────
ALTER TABLE inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_counts
  USING ("orgId" = current_setting('app.tenant_id', true))
  WITH CHECK ("orgId" = current_setting('app.tenant_id', true));

ALTER TABLE inventory_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_count_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_count_lines
  USING (EXISTS (
    SELECT 1 FROM inventory_counts c WHERE c.id = inventory_count_lines."countId" AND c."orgId" = current_setting('app.tenant_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM inventory_counts c WHERE c.id = inventory_count_lines."countId" AND c."orgId" = current_setting('app.tenant_id', true)
  ));

GRANT ALL PRIVILEGES ON inventory_counts, inventory_count_lines TO stockily_app;
