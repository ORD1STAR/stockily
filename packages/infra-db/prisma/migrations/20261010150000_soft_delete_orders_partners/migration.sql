-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- Grant the three new delete actions to the system roles that seed.ts
-- gives them to, so already-seeded databases pick them up without a
-- re-seed. A database that hasn't been seeded yet has no system roles,
-- so this inserts nothing there and seed.ts grants them instead.
INSERT INTO "role_permissions" ("id", "roleId", "moduleId", "action")
SELECT gen_random_uuid()::text, r."id", m."id", g."action"
FROM (VALUES
  ('purchasing', 'purchasing.order.delete', 'Super Admin'),
  ('purchasing', 'purchasing.order.delete', 'Gestionnaire'),
  ('sales', 'sales.order.delete', 'Super Admin'),
  ('sales', 'sales.order.delete', 'Gestionnaire'),
  ('sales', 'sales.order.delete', 'Commercial'),
  ('invoicing', 'invoicing.partner.delete', 'Super Admin'),
  ('invoicing', 'invoicing.partner.delete', 'Gestionnaire'),
  ('invoicing', 'invoicing.partner.delete', 'Comptable / Finance')
) AS g("moduleKey", "action", "roleName")
JOIN "modules" m ON m."key" = g."moduleKey"
JOIN "roles" r ON r."name" = g."roleName" AND r."isSystem" = true
ON CONFLICT ("roleId", "moduleId", "action") DO NOTHING;
