-- Dynamic NFC customer capture entry by workstation station
ALTER TABLE "SaleCustomerCaptureSession"
ADD COLUMN "stationKey" TEXT;

CREATE INDEX "SaleCustomerCaptureSession_stationKey_createdAt_idx"
ON "SaleCustomerCaptureSession"("stationKey", "createdAt");
