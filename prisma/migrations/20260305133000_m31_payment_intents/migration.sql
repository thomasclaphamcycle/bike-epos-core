-- M31 payment intent abstraction

CREATE TYPE "PaymentIntentStatus" AS ENUM (
  'REQUIRES_ACTION',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'CANCELED'
);

CREATE TABLE "PaymentIntent" (
  "id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "status" "PaymentIntentStatus" NOT NULL DEFAULT 'REQUIRES_ACTION',
  "amountPence" INTEGER NOT NULL,
  "saleId" UUID NOT NULL,
  "externalRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentIntent_saleId_createdAt_idx" ON "PaymentIntent"("saleId", "createdAt");
CREATE INDEX "PaymentIntent_provider_status_createdAt_idx" ON "PaymentIntent"("provider", "status", "createdAt");

ALTER TABLE "PaymentIntent"
  ADD CONSTRAINT "PaymentIntent_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
