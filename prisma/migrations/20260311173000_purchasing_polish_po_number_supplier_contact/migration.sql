ALTER TABLE "Supplier"
ADD COLUMN "contactName" TEXT;

ALTER TABLE "PurchaseOrder"
ADD COLUMN "poNumber" TEXT;

WITH numbered_purchase_orders AS (
  SELECT
    "id",
    TO_CHAR("createdAt", 'YYYY') AS year_code,
    ROW_NUMBER() OVER (
      PARTITION BY TO_CHAR("createdAt", 'YYYY')
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS sequence_number
  FROM "PurchaseOrder"
)
UPDATE "PurchaseOrder" AS purchase_order
SET "poNumber" = 'COREPOS-PO-' || numbered_purchase_orders.year_code || '-' || LPAD(numbered_purchase_orders.sequence_number::TEXT, 6, '0')
FROM numbered_purchase_orders
WHERE purchase_order."id" = numbered_purchase_orders."id";

ALTER TABLE "PurchaseOrder"
ALTER COLUMN "poNumber" SET NOT NULL;

CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");
