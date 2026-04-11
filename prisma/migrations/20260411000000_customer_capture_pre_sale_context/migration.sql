-- AlterTable
ALTER TABLE "Basket" ADD COLUMN     "customerId" UUID;

-- AlterTable
ALTER TABLE "SaleCustomerCaptureSession" ADD COLUMN     "basketId" UUID,
ALTER COLUMN "saleId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Basket_customerId_idx" ON "Basket"("customerId");

-- CreateIndex
CREATE INDEX "SaleCustomerCaptureSession_basketId_status_idx" ON "SaleCustomerCaptureSession"("basketId", "status");

-- AddForeignKey
ALTER TABLE "Basket" ADD CONSTRAINT "Basket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleCustomerCaptureSession" ADD CONSTRAINT "SaleCustomerCaptureSession_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "Basket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
