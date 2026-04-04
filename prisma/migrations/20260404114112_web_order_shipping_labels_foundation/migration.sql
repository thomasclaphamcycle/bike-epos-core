-- CreateEnum
CREATE TYPE "WebOrderStatus" AS ENUM ('READY_FOR_DISPATCH', 'DISPATCHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WebOrderFulfillmentMethod" AS ENUM ('SHIPPING', 'CLICK_AND_COLLECT');

-- CreateEnum
CREATE TYPE "WebOrderShipmentStatus" AS ENUM ('LABEL_READY', 'PRINT_PREPARED', 'PRINTED', 'DISPATCHED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ShipmentLabelFormat" AS ENUM ('ZPL');

-- CreateEnum
CREATE TYPE "ShipmentLabelStorageKind" AS ENUM ('INLINE_TEXT');

-- CreateTable
CREATE TABLE "WebOrder" (
    "id" UUID NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "sourceChannel" TEXT NOT NULL DEFAULT 'INTERNAL_MOCK_WEB_STORE',
    "externalOrderRef" TEXT,
    "customerId" UUID,
    "status" "WebOrderStatus" NOT NULL DEFAULT 'READY_FOR_DISPATCH',
    "fulfillmentMethod" "WebOrderFulfillmentMethod" NOT NULL DEFAULT 'SHIPPING',
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT,
    "deliveryInstructions" TEXT,
    "shippingRecipientName" TEXT NOT NULL,
    "shippingAddressLine1" TEXT NOT NULL,
    "shippingAddressLine2" TEXT,
    "shippingCity" TEXT NOT NULL,
    "shippingRegion" TEXT,
    "shippingPostcode" TEXT NOT NULL,
    "shippingCountry" TEXT NOT NULL,
    "subtotalPence" INTEGER NOT NULL,
    "shippingPricePence" INTEGER NOT NULL DEFAULT 0,
    "totalPence" INTEGER NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebOrderItem" (
    "id" UUID NOT NULL,
    "webOrderId" UUID NOT NULL,
    "variantId" TEXT,
    "sku" TEXT,
    "productName" TEXT NOT NULL,
    "variantName" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPricePence" INTEGER NOT NULL,
    "lineTotalPence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebOrderShipment" (
    "id" UUID NOT NULL,
    "webOrderId" UUID NOT NULL,
    "shipmentNumber" INTEGER NOT NULL,
    "status" "WebOrderShipmentStatus" NOT NULL DEFAULT 'LABEL_READY',
    "providerKey" TEXT NOT NULL,
    "providerDisplayName" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "labelFormat" "ShipmentLabelFormat" NOT NULL,
    "labelStorageKind" "ShipmentLabelStorageKind" NOT NULL DEFAULT 'INLINE_TEXT',
    "labelMimeType" TEXT NOT NULL,
    "labelFileName" TEXT NOT NULL,
    "labelContent" TEXT NOT NULL,
    "providerReference" TEXT,
    "providerMetadata" JSONB,
    "labelGeneratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printPreparedAt" TIMESTAMP(3),
    "printedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "reprintCount" INTEGER NOT NULL DEFAULT 0,
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebOrderShipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebOrder_orderNumber_key" ON "WebOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "WebOrder_status_placedAt_idx" ON "WebOrder"("status", "placedAt");

-- CreateIndex
CREATE INDEX "WebOrder_fulfillmentMethod_status_placedAt_idx" ON "WebOrder"("fulfillmentMethod", "status", "placedAt");

-- CreateIndex
CREATE INDEX "WebOrder_customerId_idx" ON "WebOrder"("customerId");

-- CreateIndex
CREATE INDEX "WebOrder_createdByStaffId_idx" ON "WebOrder"("createdByStaffId");

-- CreateIndex
CREATE INDEX "WebOrderItem_webOrderId_idx" ON "WebOrderItem"("webOrderId");

-- CreateIndex
CREATE INDEX "WebOrderItem_variantId_idx" ON "WebOrderItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "WebOrderShipment_trackingNumber_key" ON "WebOrderShipment"("trackingNumber");

-- CreateIndex
CREATE INDEX "WebOrderShipment_webOrderId_status_createdAt_idx" ON "WebOrderShipment"("webOrderId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WebOrderShipment_createdByStaffId_idx" ON "WebOrderShipment"("createdByStaffId");

-- CreateIndex
CREATE INDEX "WebOrderShipment_providerKey_status_createdAt_idx" ON "WebOrderShipment"("providerKey", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebOrderShipment_webOrderId_shipmentNumber_key" ON "WebOrderShipment"("webOrderId", "shipmentNumber");

-- AddForeignKey
ALTER TABLE "WebOrder" ADD CONSTRAINT "WebOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebOrder" ADD CONSTRAINT "WebOrder_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebOrderItem" ADD CONSTRAINT "WebOrderItem_webOrderId_fkey" FOREIGN KEY ("webOrderId") REFERENCES "WebOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebOrderItem" ADD CONSTRAINT "WebOrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebOrderShipment" ADD CONSTRAINT "WebOrderShipment_webOrderId_fkey" FOREIGN KEY ("webOrderId") REFERENCES "WebOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebOrderShipment" ADD CONSTRAINT "WebOrderShipment_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
