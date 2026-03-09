-- Ensure a canonical default workshop location exists before backfilling.
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

ALTER TABLE "WorkshopJob" ADD COLUMN "locationId" TEXT;

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

ALTER TABLE "WorkshopJob" ALTER COLUMN "locationId" SET NOT NULL;

CREATE INDEX "WorkshopJob_locationId_idx" ON "WorkshopJob"("locationId");

ALTER TABLE "WorkshopJob"
  ADD CONSTRAINT "WorkshopJob_locationId_fkey"
  FOREIGN KEY ("locationId")
  REFERENCES "Location"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
