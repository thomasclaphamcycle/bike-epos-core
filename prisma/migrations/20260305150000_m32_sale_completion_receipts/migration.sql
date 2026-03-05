-- M32 sale completion and receipts

ALTER TABLE "Sale"
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "receiptNumber" TEXT,
  ADD COLUMN "createdByStaffId" TEXT;

CREATE UNIQUE INDEX "Sale_receiptNumber_key" ON "Sale"("receiptNumber");
CREATE INDEX "Sale_completedAt_idx" ON "Sale"("completedAt");
CREATE INDEX "Sale_createdByStaffId_idx" ON "Sale"("createdByStaffId");

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_createdByStaffId_fkey"
  FOREIGN KEY ("createdByStaffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
