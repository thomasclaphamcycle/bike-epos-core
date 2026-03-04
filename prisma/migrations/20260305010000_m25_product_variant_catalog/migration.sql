ALTER TABLE "Variant" ADD COLUMN IF NOT EXISTS "retailPrice" DECIMAL(12,2);

UPDATE "Variant"
SET "retailPrice" = ROUND(("retailPricePence"::numeric / 100.0), 2)
WHERE "retailPrice" IS NULL;

ALTER TABLE "Variant" ALTER COLUMN "retailPrice" SET NOT NULL;
ALTER TABLE "Variant" ALTER COLUMN "retailPrice" SET DEFAULT 0;
