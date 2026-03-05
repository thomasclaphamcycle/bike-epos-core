-- M42: Cash management v1 metadata (location + note + related sale/refund links).
ALTER TABLE "CashMovement"
  ADD COLUMN "locationId" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN "note" TEXT,
  ADD COLUMN "relatedSaleId" UUID,
  ADD COLUMN "relatedRefundId" UUID;

CREATE INDEX "CashMovement_locationId_createdAt_idx" ON "CashMovement"("locationId", "createdAt");
CREATE INDEX "CashMovement_relatedSaleId_idx" ON "CashMovement"("relatedSaleId");
CREATE INDEX "CashMovement_relatedRefundId_idx" ON "CashMovement"("relatedRefundId");

ALTER TABLE "CashMovement"
  ADD CONSTRAINT "CashMovement_relatedSaleId_fkey"
  FOREIGN KEY ("relatedSaleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashMovement"
  ADD CONSTRAINT "CashMovement_relatedRefundId_fkey"
  FOREIGN KEY ("relatedRefundId") REFERENCES "Refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;
