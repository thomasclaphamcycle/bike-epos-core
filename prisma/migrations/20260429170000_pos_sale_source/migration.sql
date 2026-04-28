-- Persist the POS sale source so UI labels come from basket/sale state,
-- not from frontend-only route context.
CREATE TYPE "PosSaleSource" AS ENUM ('RETAIL', 'QUOTE', 'WEB', 'WORKSHOP', 'EXCHANGE');

ALTER TABLE "Basket"
  ADD COLUMN "source" "PosSaleSource" NOT NULL DEFAULT 'RETAIL',
  ADD COLUMN "sourceRef" TEXT;

ALTER TABLE "Sale"
  ADD COLUMN "source" "PosSaleSource" NOT NULL DEFAULT 'RETAIL',
  ADD COLUMN "sourceRef" TEXT;

UPDATE "Basket" b
SET
  "source" = 'WORKSHOP',
  "sourceRef" = w.id::text
FROM "WorkshopJob" w
WHERE w."finalizedBasketId" = b.id;

UPDATE "Sale"
SET
  "source" = 'WORKSHOP',
  "sourceRef" = "workshopJobId"::text
WHERE "workshopJobId" IS NOT NULL;

UPDATE "Sale"
SET
  "source" = 'EXCHANGE',
  "sourceRef" = "exchangeFromSaleId"::text
WHERE "workshopJobId" IS NULL
  AND "exchangeFromSaleId" IS NOT NULL;

CREATE INDEX "Basket_source_idx" ON "Basket"("source");
CREATE INDEX "Basket_source_sourceRef_idx" ON "Basket"("source", "sourceRef");
CREATE INDEX "Sale_source_idx" ON "Sale"("source");
CREATE INDEX "Sale_source_sourceRef_idx" ON "Sale"("source", "sourceRef");
