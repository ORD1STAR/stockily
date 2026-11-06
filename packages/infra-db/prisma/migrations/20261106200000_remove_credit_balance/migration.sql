-- The prepaid-balance system is removed: purchases and renewals are recorded
-- directly (offered for now, payment API later).
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "creditBalance";
ALTER TABLE "platform_payments" DROP COLUMN IF EXISTS "creditUsed";
