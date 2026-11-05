-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "seatsPerSite" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "device_activations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "fingerprintHash" TEXT NOT NULL,
    "motherboardHash" TEXT NOT NULL,
    "diskHash" TEXT NOT NULL,
    "macHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRenewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "licenseExpiresAt" TIMESTAMP(3) NOT NULL,
    "deactivatedAt" TIMESTAMP(3),
    "reactivationCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "device_activations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_activations_orgId_status_idx" ON "device_activations"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "device_activations_orgId_fingerprintHash_key" ON "device_activations"("orgId", "fingerprintHash");

-- AddForeignKey
ALTER TABLE "device_activations" ADD CONSTRAINT "device_activations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
