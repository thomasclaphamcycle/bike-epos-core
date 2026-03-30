-- AlterTable
ALTER TABLE "Variant"
ADD COLUMN     "manufacturerBarcode" TEXT,
ADD COLUMN     "internalBarcode" TEXT;

-- Backfill existing preferred barcodes as manufacturer barcodes so existing scan/print behaviour is preserved
UPDATE "Variant"
SET "manufacturerBarcode" = "barcode"
WHERE "barcode" IS NOT NULL
  AND "manufacturerBarcode" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Variant_manufacturerBarcode_key" ON "Variant"("manufacturerBarcode");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_internalBarcode_key" ON "Variant"("internalBarcode");
