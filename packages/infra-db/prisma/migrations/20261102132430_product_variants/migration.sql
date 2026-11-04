-- AlterTable
ALTER TABLE "products" ADD COLUMN     "color" TEXT,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "size" TEXT,
ADD COLUMN     "variantColors" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "variantSizes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
