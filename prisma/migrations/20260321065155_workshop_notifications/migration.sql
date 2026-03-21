-- CreateEnum
CREATE TYPE "WorkshopNotificationChannel" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "WorkshopNotificationEventType" AS ENUM ('QUOTE_READY', 'JOB_READY_FOR_COLLECTION');

-- CreateEnum
CREATE TYPE "WorkshopNotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "WorkshopNotification" (
    "id" UUID NOT NULL,
    "workshopJobId" UUID NOT NULL,
    "workshopEstimateId" UUID,
    "customerId" UUID,
    "channel" "WorkshopNotificationChannel" NOT NULL,
    "eventType" "WorkshopNotificationEventType" NOT NULL,
    "deliveryStatus" "WorkshopNotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "recipientEmail" TEXT,
    "subject" TEXT,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "reasonCode" TEXT,
    "reasonMessage" TEXT,
    "providerMessageId" TEXT,
    "payload" JSONB,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopNotification_dedupeKey_key" ON "WorkshopNotification"("dedupeKey");

-- CreateIndex
CREATE INDEX "WorkshopNotification_workshopJobId_createdAt_idx" ON "WorkshopNotification"("workshopJobId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopNotification_workshopEstimateId_createdAt_idx" ON "WorkshopNotification"("workshopEstimateId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopNotification_customerId_createdAt_idx" ON "WorkshopNotification"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopNotification_eventType_deliveryStatus_createdAt_idx" ON "WorkshopNotification"("eventType", "deliveryStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkshopNotification" ADD CONSTRAINT "WorkshopNotification_workshopJobId_fkey" FOREIGN KEY ("workshopJobId") REFERENCES "WorkshopJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopNotification" ADD CONSTRAINT "WorkshopNotification_workshopEstimateId_fkey" FOREIGN KEY ("workshopEstimateId") REFERENCES "WorkshopEstimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopNotification" ADD CONSTRAINT "WorkshopNotification_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
