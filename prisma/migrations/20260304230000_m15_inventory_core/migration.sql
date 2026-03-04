-- CreateEnum
CREATE TYPE "StockLedgerEntryType" AS ENUM ('ADJUSTMENT', 'SALE', 'WORKSHOP', 'PURCHASE', 'RETURN', 'TRANSFER');

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "supplier",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Variant" DROP COLUMN "costPence",
DROP COLUMN "pricePence",
ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "costPricePence" INTEGER,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "option" TEXT,
ADD COLUMN     "retailPricePence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxCode" TEXT;

-- CreateTable
CREATE TABLE "StockLocation" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLedgerEntry" (
    "id" UUID NOT NULL,
    "variantId" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "type" "StockLedgerEntryType" NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByStaffId" TEXT,

    CONSTRAINT "StockLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockLocation_name_idx" ON "StockLocation"("name");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_variantId_locationId_createdAt_idx" ON "StockLedgerEntry"("variantId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_referenceType_referenceId_idx" ON "StockLedgerEntry"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_createdByStaffId_idx" ON "StockLedgerEntry"("createdByStaffId");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_barcode_key" ON "Variant"("barcode");

-- AddForeignKey
ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
