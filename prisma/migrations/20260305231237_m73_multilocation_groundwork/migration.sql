-- Ensure a default business location exists for backward-compatible backfill.
INSERT INTO "Location" ("id", "name", "code", "isActive", "createdAt", "updatedAt")
SELECT "seed"."id", "seed"."name", "seed"."code", "seed"."isActive", NOW(), NOW()
FROM (
  SELECT 'loc_main'::text AS "id", 'Main'::text AS "name", 'MAIN'::text AS "code", true AS "isActive"
) AS "seed"
WHERE NOT EXISTS (
  SELECT 1
  FROM "Location"
  WHERE UPPER(COALESCE("code", '')) = 'MAIN'
);

-- Add nullable location columns first, then backfill before enforcing NOT NULL.
ALTER TABLE "Sale" ADD COLUMN "locationId" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "locationId" TEXT;
ALTER TABLE "WorkshopJob" ADD COLUMN "locationId" TEXT;

WITH "default_location" AS (
  SELECT "id"
  FROM "Location"
  WHERE UPPER(COALESCE("code", '')) = 'MAIN'
  ORDER BY "createdAt" ASC
  LIMIT 1
)
UPDATE "Sale"
SET "locationId" = (SELECT "id" FROM "default_location")
WHERE "locationId" IS NULL;

WITH "default_location" AS (
  SELECT "id"
  FROM "Location"
  WHERE UPPER(COALESCE("code", '')) = 'MAIN'
  ORDER BY "createdAt" ASC
  LIMIT 1
)
UPDATE "InventoryMovement"
SET "locationId" = (SELECT "id" FROM "default_location")
WHERE "locationId" IS NULL;

WITH "default_location" AS (
  SELECT "id"
  FROM "Location"
  WHERE UPPER(COALESCE("code", '')) = 'MAIN'
  ORDER BY "createdAt" ASC
  LIMIT 1
)
UPDATE "WorkshopJob"
SET "locationId" = (SELECT "id" FROM "default_location")
WHERE "locationId" IS NULL;

ALTER TABLE "Sale" ALTER COLUMN "locationId" SET NOT NULL;
ALTER TABLE "InventoryMovement" ALTER COLUMN "locationId" SET NOT NULL;
ALTER TABLE "WorkshopJob" ALTER COLUMN "locationId" SET NOT NULL;

CREATE INDEX "Sale_locationId_idx" ON "Sale"("locationId");
CREATE INDEX "InventoryMovement_locationId_idx" ON "InventoryMovement"("locationId");
CREATE INDEX "WorkshopJob_locationId_idx" ON "WorkshopJob"("locationId");

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_locationId_fkey"
  FOREIGN KEY ("locationId")
  REFERENCES "Location"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_locationId_fkey"
  FOREIGN KEY ("locationId")
  REFERENCES "Location"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "WorkshopJob"
  ADD CONSTRAINT "WorkshopJob_locationId_fkey"
  FOREIGN KEY ("locationId")
  REFERENCES "Location"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
