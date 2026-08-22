-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "partnerId" TEXT;

-- CreateIndex
CREATE INDEX "stock_movements_partnerId_idx" ON "stock_movements"("partnerId");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
