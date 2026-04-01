-- CreateTable
CREATE TABLE "WorkshopCheckoutOutcome" (
    "id" UUID NOT NULL,
    "workshopJobId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "customerId" UUID,
    "bikeId" UUID,
    "saleCreatedAt" TIMESTAMP(3) NOT NULL,
    "serviceTotalPence" INTEGER NOT NULL,
    "partsTotalPence" INTEGER NOT NULL,
    "saleTotalPence" INTEGER NOT NULL,
    "depositPaidPence" INTEGER NOT NULL,
    "creditPence" INTEGER NOT NULL,
    "outstandingPence" INTEGER NOT NULL,
    "finalPaymentId" UUID,
    "finalPaymentMethod" "PaymentMethod",
    "finalPaymentAmountPence" INTEGER,
    "finalPaymentProviderRef" TEXT,
    "finalPaymentCreatedAt" TIMESTAMP(3),
    "workshopJobStatus" "WorkshopJobStatus" NOT NULL,
    "workshopCompletedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopCheckoutOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopCheckoutOutcome_workshopJobId_key" ON "WorkshopCheckoutOutcome"("workshopJobId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopCheckoutOutcome_saleId_key" ON "WorkshopCheckoutOutcome"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopCheckoutOutcome_finalPaymentId_key" ON "WorkshopCheckoutOutcome"("finalPaymentId");

-- CreateIndex
CREATE INDEX "WorkshopCheckoutOutcome_customerId_idx" ON "WorkshopCheckoutOutcome"("customerId");

-- CreateIndex
CREATE INDEX "WorkshopCheckoutOutcome_bikeId_idx" ON "WorkshopCheckoutOutcome"("bikeId");

-- CreateIndex
CREATE INDEX "WorkshopCheckoutOutcome_workshopCompletedAt_idx" ON "WorkshopCheckoutOutcome"("workshopCompletedAt");

INSERT INTO "WorkshopCheckoutOutcome" (
    "id",
    "workshopJobId",
    "saleId",
    "customerId",
    "bikeId",
    "saleCreatedAt",
    "serviceTotalPence",
    "partsTotalPence",
    "saleTotalPence",
    "depositPaidPence",
    "creditPence",
    "outstandingPence",
    "finalPaymentId",
    "finalPaymentMethod",
    "finalPaymentAmountPence",
    "finalPaymentProviderRef",
    "finalPaymentCreatedAt",
    "workshopJobStatus",
    "workshopCompletedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    s."id" AS "id",
    w."id" AS "workshopJobId",
    s."id" AS "saleId",
    s."customerId",
    w."bikeId",
    s."createdAt" AS "saleCreatedAt",
    GREATEST(0, s."totalPence" - COALESCE(parts."partsTotalPence", 0)) AS "serviceTotalPence",
    COALESCE(parts."partsTotalPence", 0) AS "partsTotalPence",
    s."totalPence" AS "saleTotalPence",
    COALESCE(deposits."depositPaidPence", 0) AS "depositPaidPence",
    GREATEST(0, COALESCE(deposits."depositPaidPence", 0) - s."totalPence") AS "creditPence",
    GREATEST(0, s."totalPence" - COALESCE(deposits."depositPaidPence", 0)) AS "outstandingPence",
    final_payment."id" AS "finalPaymentId",
    final_payment."method" AS "finalPaymentMethod",
    final_payment."amountPence" AS "finalPaymentAmountPence",
    final_payment."providerRef" AS "finalPaymentProviderRef",
    final_payment."createdAt" AS "finalPaymentCreatedAt",
    CASE
        WHEN w."status" = 'CANCELLED' THEN 'CANCELLED'::"WorkshopJobStatus"
        ELSE 'COMPLETED'::"WorkshopJobStatus"
    END AS "workshopJobStatus",
    COALESCE(w."completedAt", s."completedAt", s."createdAt") AS "workshopCompletedAt",
    CURRENT_TIMESTAMP AS "createdAt",
    CURRENT_TIMESTAMP AS "updatedAt"
FROM "Sale" s
INNER JOIN "WorkshopJob" w
    ON w."id" = s."workshopJobId"
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(part."quantity" * part."unitPriceAtTime"), 0)::INTEGER AS "partsTotalPence"
    FROM "WorkshopJobPart" part
    WHERE part."workshopJobId" = w."id"
      AND part."status" = 'USED'
) parts ON TRUE
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(payment."amountPence"), 0)::INTEGER AS "depositPaidPence"
    FROM "Payment" payment
    WHERE payment."workshopJobId" = w."id"
      AND payment."purpose" = 'DEPOSIT'
      AND payment."amountPence" > 0
) deposits ON TRUE
LEFT JOIN LATERAL (
    SELECT
        payment."id",
        payment."method",
        payment."amountPence",
        payment."providerRef",
        payment."createdAt"
    FROM "Payment" payment
    WHERE payment."saleId" = s."id"
      AND payment."purpose" = 'FINAL'
      AND payment."amountPence" > 0
    ORDER BY payment."createdAt" ASC, payment."id" ASC
    LIMIT 1
) final_payment ON TRUE
WHERE s."workshopJobId" IS NOT NULL
ON CONFLICT ("workshopJobId") DO NOTHING;

-- AddForeignKey
ALTER TABLE "WorkshopCheckoutOutcome" ADD CONSTRAINT "WorkshopCheckoutOutcome_workshopJobId_fkey" FOREIGN KEY ("workshopJobId") REFERENCES "WorkshopJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopCheckoutOutcome" ADD CONSTRAINT "WorkshopCheckoutOutcome_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopCheckoutOutcome" ADD CONSTRAINT "WorkshopCheckoutOutcome_finalPaymentId_fkey" FOREIGN KEY ("finalPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
