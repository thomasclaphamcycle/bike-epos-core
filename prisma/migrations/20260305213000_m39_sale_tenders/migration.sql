-- M39: POS tender lines + change due support.
CREATE TYPE "SaleTenderMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'VOUCHER');

ALTER TABLE "Sale"
  ADD COLUMN "changeDuePence" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "SaleTender" (
  "id" UUID NOT NULL,
  "saleId" UUID NOT NULL,
  "method" "SaleTenderMethod" NOT NULL,
  "amountPence" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByStaffId" TEXT,
  CONSTRAINT "SaleTender_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SaleTender"
  ADD CONSTRAINT "SaleTender_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SaleTender"
  ADD CONSTRAINT "SaleTender_createdByStaffId_fkey"
  FOREIGN KEY ("createdByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SaleTender_saleId_createdAt_idx" ON "SaleTender"("saleId", "createdAt");
CREATE INDEX "SaleTender_createdByStaffId_idx" ON "SaleTender"("createdByStaffId");
