-- AlterTable: add columns nullable first, backfill, then enforce NOT NULL —
-- existing stock_transfers rows had their product/quantity recorded only on
-- the linked stock_movements (relatedEntityType = 'stock_transfer'), not on
-- the transfer row itself, since the ledger move used to fire at creation
-- time rather than on delivery.
ALTER TABLE "stock_transfers"
  ADD COLUMN     "batchId" TEXT,
  ADD COLUMN     "deliveredAt" TIMESTAMP(3),
  ADD COLUMN     "productId" TEXT,
  ADD COLUMN     "quantity" DECIMAL(14,3);

UPDATE "stock_transfers" st
SET "productId" = sm."productId",
    "quantity" = sm."quantity",
    "batchId" = sm."batchId"
FROM "stock_movements" sm
WHERE sm."relatedEntityType" = 'stock_transfer'
  AND sm."relatedEntityId" = st.id
  AND sm."siteId" = st."fromSiteId";

-- Any existing "delivered" transfer already had both ledger legs posted at
-- creation (the old behavior) — backfill deliveredAt from createdAt so it
-- isn't left null for a status that now implies a timestamp exists.
UPDATE "stock_transfers" SET "deliveredAt" = "createdAt" WHERE "status" = 'delivered';

ALTER TABLE "stock_transfers"
  ALTER COLUMN "productId" SET NOT NULL,
  ALTER COLUMN "quantity" SET NOT NULL;
