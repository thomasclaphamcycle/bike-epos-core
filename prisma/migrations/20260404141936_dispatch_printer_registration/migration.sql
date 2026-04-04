-- CreateEnum
CREATE TYPE "RegisteredPrinterFamily" AS ENUM ('ZEBRA_LABEL');

-- CreateEnum
CREATE TYPE "RegisteredPrinterTransportMode" AS ENUM ('DRY_RUN', 'RAW_TCP');

-- CreateTable
CREATE TABLE "Printer" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "printerFamily" "RegisteredPrinterFamily" NOT NULL DEFAULT 'ZEBRA_LABEL',
    "printerModelHint" TEXT NOT NULL DEFAULT 'GK420D_OR_COMPATIBLE',
    "supportsShippingLabels" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "transportMode" "RegisteredPrinterTransportMode" NOT NULL DEFAULT 'DRY_RUN',
    "rawTcpHost" TEXT,
    "rawTcpPort" INTEGER,
    "location" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Printer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Printer_key_key" ON "Printer"("key");

-- CreateIndex
CREATE INDEX "Printer_supportsShippingLabels_isActive_idx" ON "Printer"("supportsShippingLabels", "isActive");

-- CreateIndex
CREATE INDEX "Printer_transportMode_isActive_idx" ON "Printer"("transportMode", "isActive");
