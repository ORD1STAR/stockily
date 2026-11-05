-- CreateTable
CREATE TABLE "number_blocks" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceActivationId" TEXT NOT NULL,
    "counterKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "start" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "lastUsed" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "number_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_replay_log" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceActivationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "responseBody" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_replay_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_outbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "body" JSONB,
    "localResponse" JSONB,
    "numbers" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "httpStatus" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "local_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_id_map" (
    "localId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_id_map_pkey" PRIMARY KEY ("localId")
);

-- CreateIndex
CREATE INDEX "number_blocks_orgId_deviceActivationId_counterKey_year_idx" ON "number_blocks"("orgId", "deviceActivationId", "counterKey", "year");

-- CreateIndex
CREATE UNIQUE INDEX "sync_replay_log_idempotencyKey_key" ON "sync_replay_log"("idempotencyKey");

-- CreateIndex
CREATE INDEX "sync_replay_log_orgId_createdAt_idx" ON "sync_replay_log"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "local_outbox_status_createdAt_idx" ON "local_outbox"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "number_blocks" ADD CONSTRAINT "number_blocks_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_replay_log" ADD CONSTRAINT "sync_replay_log_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────── Row-Level Security ─────────
-- device_activations was created by the previous migration
-- (20261104231625_device_activations) without its policy; added here with
-- the rest of the offline/desktop tables.
ALTER TABLE device_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_activations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON device_activations USING ("orgId" = current_setting('app.tenant_id', true)) WITH CHECK ("orgId" = current_setting('app.tenant_id', true));
GRANT ALL PRIVILEGES ON device_activations TO stockily_app;

ALTER TABLE number_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE number_blocks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON number_blocks USING ("orgId" = current_setting('app.tenant_id', true)) WITH CHECK ("orgId" = current_setting('app.tenant_id', true));
GRANT ALL PRIVILEGES ON number_blocks TO stockily_app;

ALTER TABLE sync_replay_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_replay_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sync_replay_log USING ("orgId" = current_setting('app.tenant_id', true)) WITH CHECK ("orgId" = current_setting('app.tenant_id', true));
GRANT ALL PRIVILEGES ON sync_replay_log TO stockily_app;

-- Device-local bookkeeping: a desktop database only ever holds one org, and
-- the sync engine reads these outside any request (no tenant context), so
-- no tenant policy — privileges only. Always empty on the server.
GRANT ALL PRIVILEGES ON local_outbox TO stockily_app;
GRANT ALL PRIVILEGES ON local_id_map TO stockily_app;
