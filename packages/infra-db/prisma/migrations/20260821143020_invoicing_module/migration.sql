/*
  Warnings:

  - Added the required column `siteId` to the `invoices` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "siteId" TEXT NOT NULL,
ALTER COLUMN "number" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'draft';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "address" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "nif" TEXT,
ADD COLUMN     "nis" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "rc" TEXT,
ADD COLUMN     "taxArticle" TEXT;

-- CreateTable
CREATE TABLE "invoice_counters" (
    "orgId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("orgId","year")
);

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
