-- CreateEnum
CREATE TYPE "ShippingProviderSyncEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateTable
CREATE TABLE "ShippingProviderSyncEvent" (
    "id" UUID NOT NULL,
    "providerKey" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "providerEventType" TEXT NOT NULL,
    "shipmentId" UUID,
    "providerShipmentReference" TEXT,
    "providerTrackingReference" TEXT,
    "trackingNumber" TEXT,
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "status" "ShippingProviderSyncEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "occurredAt" TIMESTAMP(3),
    "firstReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "syncAppliedAt" TIMESTAMP(3),
    "deliveryCount" INTEGER NOT NULL DEFAULT 1,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingProviderSyncEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShippingProviderSyncEvent_providerKey_status_lastReceivedAt_idx" ON "ShippingProviderSyncEvent"("providerKey", "status", "lastReceivedAt");

-- CreateIndex
CREATE INDEX "ShippingProviderSyncEvent_shipmentId_createdAt_idx" ON "ShippingProviderSyncEvent"("shipmentId", "createdAt");

-- CreateIndex
CREATE INDEX "ShippingProviderSyncEvent_providerKey_providerShipmentRefer_idx" ON "ShippingProviderSyncEvent"("providerKey", "providerShipmentReference");

-- CreateIndex
CREATE INDEX "ShippingProviderSyncEvent_providerKey_providerTrackingRefer_idx" ON "ShippingProviderSyncEvent"("providerKey", "providerTrackingReference");

-- CreateIndex
CREATE INDEX "ShippingProviderSyncEvent_providerKey_trackingNumber_idx" ON "ShippingProviderSyncEvent"("providerKey", "trackingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingProviderSyncEvent_providerKey_providerEventId_key" ON "ShippingProviderSyncEvent"("providerKey", "providerEventId");

-- AddForeignKey
ALTER TABLE "ShippingProviderSyncEvent" ADD CONSTRAINT "ShippingProviderSyncEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "WebOrderShipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
