-- AlterTable
ALTER TABLE "WebOrder" ADD COLUMN     "packedAt" TIMESTAMP(3),
ADD COLUMN     "packedByStaffId" TEXT;

-- CreateIndex
CREATE INDEX "WebOrder_packedAt_status_placedAt_idx" ON "WebOrder"("packedAt", "status", "placedAt");

-- CreateIndex
CREATE INDEX "WebOrder_packedByStaffId_idx" ON "WebOrder"("packedByStaffId");

-- AddForeignKey
ALTER TABLE "WebOrder" ADD CONSTRAINT "WebOrder_packedByStaffId_fkey" FOREIGN KEY ("packedByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
