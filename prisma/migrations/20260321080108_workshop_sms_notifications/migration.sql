-- AlterEnum
ALTER TYPE "WorkshopNotificationChannel" ADD VALUE 'SMS';

-- AlterTable
ALTER TABLE "WorkshopNotification" ADD COLUMN     "recipientPhone" TEXT;
