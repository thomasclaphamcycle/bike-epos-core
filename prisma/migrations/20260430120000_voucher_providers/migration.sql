CREATE TABLE "VoucherProvider" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "commissionBps" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VoucherProvider_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoucherProvider_name_key" ON "VoucherProvider"("name");
CREATE INDEX "VoucherProvider_isActive_name_idx" ON "VoucherProvider"("isActive", "name");

ALTER TABLE "SaleTender"
  ADD COLUMN "voucherProviderId" UUID,
  ADD COLUMN "voucherCommissionBps" INTEGER;

CREATE INDEX "SaleTender_voucherProviderId_idx" ON "SaleTender"("voucherProviderId");

ALTER TABLE "SaleTender"
  ADD CONSTRAINT "SaleTender_voucherProviderId_fkey"
  FOREIGN KEY ("voucherProviderId") REFERENCES "VoucherProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
