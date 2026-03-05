-- M45: Goods receiving v1 with purchase receipts and inventory movement type.
DO $$
BEGIN
  ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'RECEIVED_PARTIAL';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'RECEIVED_COMPLETE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "InventoryMovementType" ADD VALUE 'PURCHASE_RECEIPT';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE "PurchaseReceipt" (
  "id" UUID NOT NULL,
  "purchaseOrderId" UUID NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedByStaffId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseReceiptLine" (
  "id" UUID NOT NULL,
  "receiptId" UUID NOT NULL,
  "purchaseOrderLineId" UUID NOT NULL,
  "quantityReceived" INTEGER NOT NULL,
  "unitCostPence" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReceiptLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseReceipt_purchaseOrderId_receivedAt_idx" ON "PurchaseReceipt"("purchaseOrderId", "receivedAt");
CREATE INDEX "PurchaseReceipt_receivedByStaffId_idx" ON "PurchaseReceipt"("receivedByStaffId");

CREATE UNIQUE INDEX "PurchaseReceiptLine_receiptId_purchaseOrderLineId_key" ON "PurchaseReceiptLine"("receiptId", "purchaseOrderLineId");
CREATE INDEX "PurchaseReceiptLine_purchaseOrderLineId_idx" ON "PurchaseReceiptLine"("purchaseOrderLineId");

ALTER TABLE "PurchaseReceipt"
  ADD CONSTRAINT "PurchaseReceipt_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PurchaseReceipt"
  ADD CONSTRAINT "PurchaseReceipt_receivedByStaffId_fkey"
  FOREIGN KEY ("receivedByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseReceiptLine"
  ADD CONSTRAINT "PurchaseReceiptLine_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PurchaseReceiptLine"
  ADD CONSTRAINT "PurchaseReceiptLine_purchaseOrderLineId_fkey"
  FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
