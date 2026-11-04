-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "paymentMode" TEXT,
ADD COLUMN     "stampDuty" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "stampDutyRate" DECIMAL(5,2);
