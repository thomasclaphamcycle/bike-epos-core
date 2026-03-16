INSERT INTO "StockLocation" ("id", "name", "isDefault", "createdAt")
SELECT '11111111-1111-4111-8111-111111111111'::uuid, 'Default', true, NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM "StockLocation"
  WHERE "isDefault" = true
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'InventoryMovement_locationId_fkey'
  ) THEN
    ALTER TABLE "InventoryMovement"
      DROP CONSTRAINT "InventoryMovement_locationId_fkey";
  END IF;
END $$;

ALTER TABLE "InventoryMovement"
ADD COLUMN IF NOT EXISTS "locationId" UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'InventoryMovement'
      AND column_name = 'locationId'
      AND udt_name <> 'uuid'
  ) THEN
    ALTER TABLE "InventoryMovement"
      ALTER COLUMN "locationId" TYPE UUID
      USING CASE
        WHEN "locationId" IS NULL THEN NULL
        ELSE '11111111-1111-4111-8111-111111111111'::uuid
      END;
  END IF;
END $$;

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

ALTER TABLE "InventoryMovement"
ALTER COLUMN "locationId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "InventoryMovement_locationId_idx"
ON "InventoryMovement"("locationId");

CREATE INDEX IF NOT EXISTS "InventoryMovement_variantId_locationId_createdAt_idx"
ON "InventoryMovement"("variantId", "locationId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'InventoryMovement_locationId_fkey'
  ) THEN
    ALTER TABLE "InventoryMovement"
      ADD CONSTRAINT "InventoryMovement_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
