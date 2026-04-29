ALTER TABLE "Customer"
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "postcode" TEXT;

CREATE INDEX "Customer_postcode_idx" ON "Customer"("postcode");
