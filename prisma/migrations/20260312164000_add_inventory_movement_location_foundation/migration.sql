ALTER TABLE "InventoryMovement"
ADD COLUMN "locationId" UUID;

INSERT INTO "StockLocation" ("id", "name", "isDefault", "createdAt")
SELECT '11111111-1111-4111-8111-111111111111'::uuid, 'Default', true, NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM "StockLocation"
  WHERE "isDefault" = true
);

WITH default_location AS (
  SELECT "id"
  FROM "StockLocation"
  WHERE "isDefault" = true
  ORDER BY "createdAt" ASC, "id" ASC
  LIMIT 1
)
UPDATE "InventoryMovement"
SET "locationId" = (SELECT "id" FROM default_location)
WHERE "locationId" IS NULL;

CREATE INDEX "InventoryMovement_locationId_idx" ON "InventoryMovement"("locationId");
CREATE INDEX "InventoryMovement_variantId_locationId_createdAt_idx"
ON "InventoryMovement"("variantId", "locationId", "createdAt");

ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
