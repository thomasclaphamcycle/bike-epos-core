-- M34 customer identity enhancements

ALTER TABLE "Customer"
  ADD COLUMN "name" TEXT NOT NULL DEFAULT '';

UPDATE "Customer"
SET "name" = TRIM(CONCAT("firstName", ' ', "lastName"))
WHERE "name" = '';

CREATE INDEX "Customer_name_idx" ON "Customer"("name");
