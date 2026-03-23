-- CreateEnum
CREATE TYPE "WorkshopMessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "WorkshopMessageChannel" AS ENUM ('PORTAL', 'EMAIL', 'SMS', 'WHATSAPP', 'INTERNAL_SYSTEM');

-- CreateEnum
CREATE TYPE "WorkshopMessageDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'RECEIVED', 'FAILED');

-- AlterEnum
ALTER TYPE "WorkshopNotificationEventType" ADD VALUE 'PORTAL_MESSAGE';

-- CreateTable
CREATE TABLE "WorkshopConversation" (
    "id" UUID NOT NULL,
    "workshopJobId" UUID NOT NULL,
    "customerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkshopMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "direction" "WorkshopMessageDirection" NOT NULL,
    "channel" "WorkshopMessageChannel" NOT NULL,
    "authorStaffId" TEXT,
    "customerVisible" BOOLEAN NOT NULL DEFAULT true,
    "body" TEXT NOT NULL,
    "deliveryStatus" "WorkshopMessageDeliveryStatus",
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "externalMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopConversation_workshopJobId_key" ON "WorkshopConversation"("workshopJobId");

-- CreateIndex
CREATE INDEX "WorkshopConversation_customerId_updatedAt_idx" ON "WorkshopConversation"("customerId", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkshopMessage_conversationId_createdAt_idx" ON "WorkshopMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopMessage_authorStaffId_idx" ON "WorkshopMessage"("authorStaffId");

-- CreateIndex
CREATE INDEX "WorkshopMessage_direction_createdAt_idx" ON "WorkshopMessage"("direction", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkshopConversation" ADD CONSTRAINT "WorkshopConversation_workshopJobId_fkey" FOREIGN KEY ("workshopJobId") REFERENCES "WorkshopJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopConversation" ADD CONSTRAINT "WorkshopConversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopMessage" ADD CONSTRAINT "WorkshopMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WorkshopConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopMessage" ADD CONSTRAINT "WorkshopMessage_authorStaffId_fkey" FOREIGN KEY ("authorStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
