UPDATE "Customer"
SET
  "firstName" = CASE
    WHEN COALESCE(BTRIM("firstName"), '') <> '' THEN "firstName"
    WHEN COALESCE(BTRIM("name"), '') = '' THEN "firstName"
    ELSE split_part(BTRIM("name"), ' ', 1)
  END,
  "lastName" = CASE
    WHEN COALESCE(BTRIM("lastName"), '') <> '' THEN "lastName"
    WHEN COALESCE(BTRIM("name"), '') = '' THEN "lastName"
    ELSE BTRIM(regexp_replace(BTRIM("name"), '^\S+\s*', ''))
  END
WHERE COALESCE(BTRIM("name"), '') <> '';

DROP INDEX IF EXISTS "Customer_name_idx";
ALTER TABLE "Customer" DROP COLUMN "name";
CREATE INDEX "Customer_firstName_idx" ON "Customer"("firstName");
CREATE INDEX "Customer_lastName_idx" ON "Customer"("lastName");
