-- CreateEnum
CREATE TYPE "SaleCustomerCaptureSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED');

-- CreateTable
CREATE TABLE "SaleCustomerCaptureSession" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "status" "SaleCustomerCaptureSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedFirstName" TEXT,
    "submittedLastName" TEXT,
    "submittedEmail" TEXT,
    "submittedPhone" TEXT,
    "emailMarketingConsent" BOOLEAN,
    "smsMarketingConsent" BOOLEAN,
    "customerId" UUID,

    CONSTRAINT "SaleCustomerCaptureSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaleCustomerCaptureSession_token_key" ON "SaleCustomerCaptureSession"("token");

-- CreateIndex
CREATE INDEX "SaleCustomerCaptureSession_saleId_status_idx" ON "SaleCustomerCaptureSession"("saleId", "status");

-- CreateIndex
CREATE INDEX "SaleCustomerCaptureSession_expiresAt_idx" ON "SaleCustomerCaptureSession"("expiresAt");

-- CreateIndex
CREATE INDEX "SaleCustomerCaptureSession_customerId_idx" ON "SaleCustomerCaptureSession"("customerId");

-- AddForeignKey
ALTER TABLE "SaleCustomerCaptureSession" ADD CONSTRAINT "SaleCustomerCaptureSession_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleCustomerCaptureSession" ADD CONSTRAINT "SaleCustomerCaptureSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
