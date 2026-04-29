CREATE TYPE "LayawayStatus" AS ENUM ('ACTIVE', 'PART_PAID', 'COMPLETED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "Layaway" (
  "id" UUID NOT NULL,
  "saleId" UUID NOT NULL,
  "basketId" UUID,
  "customerId" UUID,
  "status" "LayawayStatus" NOT NULL DEFAULT 'ACTIVE',
  "totalPence" INTEGER NOT NULL,
  "depositPaidPence" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "stockReleasedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdByStaffId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Layaway_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LayawayReservation" (
  "id" UUID NOT NULL,
  "layawayId" UUID NOT NULL,
  "saleItemId" UUID NOT NULL,
  "variantId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "stockReleasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LayawayReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Layaway_saleId_key" ON "Layaway"("saleId");
CREATE INDEX "Layaway_status_expiresAt_idx" ON "Layaway"("status", "expiresAt");
CREATE INDEX "Layaway_customerId_idx" ON "Layaway"("customerId");
CREATE INDEX "Layaway_createdByStaffId_idx" ON "Layaway"("createdByStaffId");

CREATE UNIQUE INDEX "LayawayReservation_saleItemId_key" ON "LayawayReservation"("saleItemId");
CREATE INDEX "LayawayReservation_layawayId_idx" ON "LayawayReservation"("layawayId");
CREATE INDEX "LayawayReservation_variantId_idx" ON "LayawayReservation"("variantId");

ALTER TABLE "Layaway"
  ADD CONSTRAINT "Layaway_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Layaway"
  ADD CONSTRAINT "Layaway_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Layaway"
  ADD CONSTRAINT "Layaway_createdByStaffId_fkey"
  FOREIGN KEY ("createdByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LayawayReservation"
  ADD CONSTRAINT "LayawayReservation_layawayId_fkey"
  FOREIGN KEY ("layawayId") REFERENCES "Layaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LayawayReservation"
  ADD CONSTRAINT "LayawayReservation_saleItemId_fkey"
  FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LayawayReservation"
  ADD CONSTRAINT "LayawayReservation_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
