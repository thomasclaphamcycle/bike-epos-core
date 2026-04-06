-- AlterEnum
ALTER TYPE "RegisteredPrinterFamily" ADD VALUE 'OFFICE_DOCUMENT';

-- AlterTable
ALTER TABLE "Printer" ADD COLUMN     "supportsBikeTags" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Printer_supportsBikeTags_isActive_idx" ON "Printer"("supportsBikeTags", "isActive");
