/*
  Warnings:

  - Added the required column `stockLocationId` to the `WorkshopJobPart` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "WorkshopJobPart" ADD COLUMN     "stockLocationId" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "WorkshopJobPart_stockLocationId_idx" ON "WorkshopJobPart"("stockLocationId");

-- CreateIndex
CREATE INDEX "WorkshopJobPart_variantId_stockLocationId_status_idx" ON "WorkshopJobPart"("variantId", "stockLocationId", "status");

-- AddForeignKey
ALTER TABLE "WorkshopJobPart" ADD CONSTRAINT "WorkshopJobPart_stockLocationId_fkey" FOREIGN KEY ("stockLocationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
