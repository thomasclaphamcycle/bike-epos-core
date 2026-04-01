-- AlterTable
ALTER TABLE "HireAsset" ADD COLUMN     "isOnlineBookable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storageLocation" TEXT;

-- AlterTable
ALTER TABLE "HireBooking" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledByStaffId" TEXT,
ADD COLUMN     "damageNotes" TEXT,
ADD COLUMN     "pickupNotes" TEXT,
ADD COLUMN     "returnNotes" TEXT;

-- CreateIndex
CREATE INDEX "HireBooking_status_startsAt_idx" ON "HireBooking"("status", "startsAt");

-- AddForeignKey
ALTER TABLE "HireBooking" ADD CONSTRAINT "HireBooking_cancelledByStaffId_fkey" FOREIGN KEY ("cancelledByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
