-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "code" TEXT,
ADD COLUMN     "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "priceTier" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "sellPrice2" DECIMAL(14,2);
