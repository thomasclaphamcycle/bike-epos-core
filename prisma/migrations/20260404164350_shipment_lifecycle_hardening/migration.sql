-- AlterEnum
ALTER TYPE "WebOrderShipmentStatus" ADD VALUE 'VOID_PENDING';

-- AlterTable
ALTER TABLE "WebOrderShipment" ADD COLUMN     "providerRefundStatus" TEXT,
ADD COLUMN     "providerSyncError" TEXT,
ADD COLUMN     "providerSyncedAt" TIMESTAMP(3),
ADD COLUMN     "voidRequestedAt" TIMESTAMP(3),
ADD COLUMN     "voidedAt" TIMESTAMP(3);
