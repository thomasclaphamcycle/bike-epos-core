-- M41: Refunds v1 (sale refunds with lines, tenders, and receipt linkage).
CREATE TYPE "RefundRecordStatus" AS ENUM ('DRAFT', 'COMPLETED', 'VOID');
CREATE TYPE "RefundTenderType" AS ENUM ('CASH', 'CARD', 'VOUCHER', 'OTHER');

ALTER TABLE "Receipt"
  ADD COLUMN "saleRefundId" UUID;

CREATE UNIQUE INDEX "Receipt_saleRefundId_key" ON "Receipt"("saleRefundId");

CREATE TABLE "Refund" (
  "id" UUID NOT NULL,
  "saleId" UUID NOT NULL,
  "status" "RefundRecordStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "subtotalPence" INTEGER NOT NULL DEFAULT 0,
  "taxPence" INTEGER NOT NULL DEFAULT 0,
  "totalPence" INTEGER NOT NULL DEFAULT 0,
  "createdByStaffId" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RefundLine" (
  "id" UUID NOT NULL,
  "refundId" UUID NOT NULL,
  "saleLineId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPricePence" INTEGER NOT NULL,
  "lineTotalPence" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefundLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RefundTender" (
  "id" UUID NOT NULL,
  "refundId" UUID NOT NULL,
  "tenderType" "RefundTenderType" NOT NULL,
  "amountPence" INTEGER NOT NULL,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByStaffId" TEXT,
  CONSTRAINT "RefundTender_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Refund_saleId_createdAt_idx" ON "Refund"("saleId", "createdAt");
CREATE INDEX "Refund_status_createdAt_idx" ON "Refund"("status", "createdAt");
CREATE INDEX "Refund_createdByStaffId_idx" ON "Refund"("createdByStaffId");

CREATE UNIQUE INDEX "RefundLine_refundId_saleLineId_key" ON "RefundLine"("refundId", "saleLineId");
CREATE INDEX "RefundLine_saleLineId_idx" ON "RefundLine"("saleLineId");

CREATE INDEX "RefundTender_refundId_createdAt_idx" ON "RefundTender"("refundId", "createdAt");
CREATE INDEX "RefundTender_createdByStaffId_idx" ON "RefundTender"("createdByStaffId");

ALTER TABLE "Receipt"
  ADD CONSTRAINT "Receipt_saleRefundId_fkey"
  FOREIGN KEY ("saleRefundId") REFERENCES "Refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_createdByStaffId_fkey"
  FOREIGN KEY ("createdByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RefundLine"
  ADD CONSTRAINT "RefundLine_refundId_fkey"
  FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RefundLine"
  ADD CONSTRAINT "RefundLine_saleLineId_fkey"
  FOREIGN KEY ("saleLineId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RefundTender"
  ADD CONSTRAINT "RefundTender_refundId_fkey"
  FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RefundTender"
  ADD CONSTRAINT "RefundTender_createdByStaffId_fkey"
  FOREIGN KEY ("createdByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
