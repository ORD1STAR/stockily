-- CreateTable
CREATE TABLE "cash_entries" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "siteId" TEXT,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'especes',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "partnerId" TEXT,
    "productId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "cash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_entries_orgId_occurredAt_idx" ON "cash_entries"("orgId", "occurredAt");

-- AddForeignKey
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────── Row-Level Security ─────────
ALTER TABLE cash_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cash_entries USING ("orgId" = current_setting('app.tenant_id', true)) WITH CHECK ("orgId" = current_setting('app.tenant_id', true));
GRANT ALL PRIVILEGES ON cash_entries TO stockily_app;
