-- M44: Purchase Orders v1 snapshot and submit/cancel metadata.
DO $$
BEGIN
  ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'SUBMITTED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "PurchaseOrder"
  ADD COLUMN "referenceCode" TEXT,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'GBP',
  ADD COLUMN "subtotalPence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taxPence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalPence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "createdByStaffId" TEXT;

ALTER TABLE "PurchaseOrderItem"
  ADD COLUMN "lineTotalPence" INTEGER;

CREATE UNIQUE INDEX "PurchaseOrder_referenceCode_key" ON "PurchaseOrder"("referenceCode");
CREATE INDEX "PurchaseOrder_createdByStaffId_idx" ON "PurchaseOrder"("createdByStaffId");

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_createdByStaffId_fkey"
  FOREIGN KEY ("createdByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
