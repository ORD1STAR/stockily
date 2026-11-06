-- Self-service billing (Espace client / Tarifs): paid periods, auto-renew,
-- prepaid credit, richer platform payments, user phone number.
ALTER TABLE "organizations" ADD COLUMN "creditBalance" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "organization_module_entitlements" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "organization_module_entitlements" ADD COLUMN "autoRenew" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "phone" TEXT;
ALTER TABLE "platform_payments" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'purchase';
ALTER TABLE "platform_payments" ADD COLUMN "number" TEXT;
ALTER TABLE "platform_payments" ADD COLUMN "items" JSONB;
ALTER TABLE "platform_payments" ADD COLUMN "creditUsed" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "platform_payments" ADD COLUMN "userId" TEXT;
CREATE UNIQUE INDEX "platform_payments_number_key" ON "platform_payments"("number");

-- Default monthly prices for the Phase 2 modules that are now built, so
-- every product module is purchasable. Never overwrites an admin's price.
INSERT INTO "module_prices" ("id", "moduleKey", "monthlyPrice", "currency", "isActive", "updatedAt") VALUES
  (gen_random_uuid(), 'purchasing', 3500, 'DZD', true, now()),
  (gen_random_uuid(), 'sales',      3500, 'DZD', true, now()),
  (gen_random_uuid(), 'cash',       2500, 'DZD', true, now()),
  (gen_random_uuid(), 'stats',      2000, 'DZD', true, now()),
  (gen_random_uuid(), 'stock',      4500, 'DZD', true, now()),
  (gen_random_uuid(), 'quality',    3000, 'DZD', true, now()),
  (gen_random_uuid(), 'invoicing',  4000, 'DZD', true, now()),
  (gen_random_uuid(), 'sites',      1500, 'DZD', true, now()),
  (gen_random_uuid(), 'scan',       2000, 'DZD', true, now())
ON CONFLICT ("moduleKey") DO NOTHING;
