-- Automatic renewal is removed: a module is extended by buying more months.
ALTER TABLE "organization_module_entitlements" DROP COLUMN IF EXISTS "autoRenew";
