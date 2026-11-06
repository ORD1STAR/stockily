-- Multi-sites billing: first site free for life, paid per extra site.
ALTER TABLE "organization_module_entitlements" ADD COLUMN "siteQuota" INTEGER;

-- Public "Proposer des ajouts" form → admin console.
CREATE TABLE "feature_suggestions" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "activity" TEXT,
    "area" TEXT,
    "need" TEXT NOT NULL,
    "priority" TEXT,
    "currentTool" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feature_suggestions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "feature_suggestions_status_createdAt_idx" ON "feature_suggestions"("status", "createdAt");
-- Platform data: RLS enabled and forced with no policy, so only the
-- superuser client can read or write (same as module_prices etc.).
ALTER TABLE feature_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_suggestions FORCE ROW LEVEL SECURITY;
