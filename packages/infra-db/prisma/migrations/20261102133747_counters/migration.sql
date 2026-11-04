-- AlterTable
ALTER TABLE "trade_documents" ADD COLUMN     "amountPaidAtCounter" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "counterSessionId" TEXT,
ADD COLUMN     "paymentMethod" TEXT;

-- CreateTable
CREATE TABLE "counters" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counter_sessions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "counterId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "openedBy" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingCash" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "countedCash" DECIMAL(14,2),
    "expectedCash" DECIMAL(14,2),
    "notes" TEXT,

    CONSTRAINT "counter_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counter_cash_movements" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counter_cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "counters_orgId_idx" ON "counters"("orgId");

-- CreateIndex
CREATE INDEX "counter_sessions_counterId_status_idx" ON "counter_sessions"("counterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "counter_sessions_orgId_number_key" ON "counter_sessions"("orgId", "number");

-- AddForeignKey
ALTER TABLE "trade_documents" ADD CONSTRAINT "trade_documents_counterSessionId_fkey" FOREIGN KEY ("counterSessionId") REFERENCES "counter_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counters" ADD CONSTRAINT "counters_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counters" ADD CONSTRAINT "counters_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_sessions" ADD CONSTRAINT "counter_sessions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_sessions" ADD CONSTRAINT "counter_sessions_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "counters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_cash_movements" ADD CONSTRAINT "counter_cash_movements_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "counter_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────── Row-Level Security ─────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['counters', 'counter_sessions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("orgId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("orgId" = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END
$$;
ALTER TABLE counter_cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE counter_cash_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON counter_cash_movements
  USING (EXISTS (SELECT 1 FROM counter_sessions s WHERE s.id = counter_cash_movements."sessionId" AND s."orgId" = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM counter_sessions s WHERE s.id = counter_cash_movements."sessionId" AND s."orgId" = current_setting('app.tenant_id', true)));
GRANT ALL PRIVILEGES ON counters, counter_sessions, counter_cash_movements TO stockily_app;
