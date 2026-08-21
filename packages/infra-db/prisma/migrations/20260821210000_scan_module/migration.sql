-- AlterTable
-- barcode_labels was empty in every environment this was checked against
-- (dev, both e2e test databases) — safe to add orgId as NOT NULL directly,
-- no backfill needed.
ALTER TABLE "barcode_labels" ADD COLUMN "orgId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "barcode_labels_orgId_codeValue_key" ON "barcode_labels"("orgId", "codeValue");

-- CreateIndex
CREATE INDEX "barcode_labels_orgId_idx" ON "barcode_labels"("orgId");

-- AddForeignKey
ALTER TABLE "barcode_labels" ADD CONSTRAINT "barcode_labels_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
