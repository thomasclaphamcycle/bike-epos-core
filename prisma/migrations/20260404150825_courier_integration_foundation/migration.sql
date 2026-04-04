-- AlterTable
ALTER TABLE "WebOrderShipment" ADD COLUMN     "providerEnvironment" TEXT,
ADD COLUMN     "providerLabelReference" TEXT,
ADD COLUMN     "providerShipmentReference" TEXT,
ADD COLUMN     "providerStatus" TEXT,
ADD COLUMN     "providerTrackingReference" TEXT;

-- CreateIndex
CREATE INDEX "WebOrderShipment_providerKey_providerStatus_createdAt_idx" ON "WebOrderShipment"("providerKey", "providerStatus", "createdAt");
