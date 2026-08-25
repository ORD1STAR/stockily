-- AlterTable
ALTER TABLE "products" ADD COLUMN     "barcode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "products_orgId_barcode_key" ON "products"("orgId", "barcode");

