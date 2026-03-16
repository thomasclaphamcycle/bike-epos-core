CREATE TABLE "HistoricalFinancialSummary" (
  "id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "grossRevenuePence" INTEGER NOT NULL,
  "netRevenuePence" INTEGER NOT NULL,
  "costOfGoodsPence" INTEGER NOT NULL,
  "transactionCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "HistoricalFinancialSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HistoricalFinancialSummary_date_key" ON "HistoricalFinancialSummary"("date");
CREATE INDEX "HistoricalFinancialSummary_date_idx" ON "HistoricalFinancialSummary"("date");
