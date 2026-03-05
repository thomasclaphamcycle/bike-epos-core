-- M30 workshop job line workflow (additive)

ALTER TABLE "WorkshopJob"
  ADD COLUMN "customerName" TEXT,
  ADD COLUMN "bikeDescription" TEXT,
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "finalizedBasketId" UUID;

CREATE INDEX "WorkshopJob_finalizedBasketId_idx" ON "WorkshopJob"("finalizedBasketId");

CREATE TYPE "WorkshopJobLineType" AS ENUM ('PART', 'LABOUR');

CREATE TABLE "WorkshopJobLine" (
  "id" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "type" "WorkshopJobLineType" NOT NULL,
  "productId" TEXT,
  "variantId" TEXT,
  "description" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  "unitPricePence" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkshopJobLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkshopJobLine_jobId_createdAt_idx" ON "WorkshopJobLine"("jobId", "createdAt");
CREATE INDEX "WorkshopJobLine_type_idx" ON "WorkshopJobLine"("type");
CREATE INDEX "WorkshopJobLine_productId_idx" ON "WorkshopJobLine"("productId");
CREATE INDEX "WorkshopJobLine_variantId_idx" ON "WorkshopJobLine"("variantId");

ALTER TABLE "WorkshopJobLine"
  ADD CONSTRAINT "WorkshopJobLine_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "WorkshopJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkshopJobLine"
  ADD CONSTRAINT "WorkshopJobLine_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkshopJobLine"
  ADD CONSTRAINT "WorkshopJobLine_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
