CREATE TYPE "WorkshopEstimateDecisionSource" AS ENUM ('STAFF', 'CUSTOMER');

ALTER TABLE "WorkshopEstimate"
ADD COLUMN "decisionSource" "WorkshopEstimateDecisionSource",
ADD COLUMN "customerQuoteToken" TEXT,
ADD COLUMN "customerQuoteTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "WorkshopEstimate_customerQuoteToken_key" ON "WorkshopEstimate"("customerQuoteToken");
CREATE INDEX "WorkshopEstimate_customerQuoteTokenExpiresAt_idx" ON "WorkshopEstimate"("customerQuoteTokenExpiresAt");
