CREATE TYPE "SaleCustomerCaptureMatchType" AS ENUM ('EMAIL', 'PHONE', 'CREATED');

ALTER TABLE "SaleCustomerCaptureSession"
ADD COLUMN "matchType" "SaleCustomerCaptureMatchType";
