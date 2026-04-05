-- AlterEnum
ALTER TYPE "RegisteredPrinterFamily" ADD VALUE 'DYMO_LABEL';

-- AlterEnum
ALTER TYPE "RegisteredPrinterTransportMode" ADD VALUE 'WINDOWS_PRINTER';

-- AlterTable
ALTER TABLE "Printer" ADD COLUMN     "supportsProductLabels" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "windowsPrinterName" TEXT;

-- CreateIndex
CREATE INDEX "Printer_supportsProductLabels_isActive_idx" ON "Printer"("supportsProductLabels", "isActive");

-- CreateIndex
CREATE INDEX "Printer_printerFamily_isActive_idx" ON "Printer"("printerFamily", "isActive");
