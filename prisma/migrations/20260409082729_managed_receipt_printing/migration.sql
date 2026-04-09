-- AlterEnum
ALTER TYPE "RegisteredPrinterFamily" ADD VALUE 'THERMAL_RECEIPT';

-- AlterTable
ALTER TABLE "Printer" ADD COLUMN     "supportsReceipts" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Printer_supportsReceipts_isActive_idx" ON "Printer"("supportsReceipts", "isActive");
