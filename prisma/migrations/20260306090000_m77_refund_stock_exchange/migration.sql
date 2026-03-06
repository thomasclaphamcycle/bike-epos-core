-- M77: refund return-to-stock + exchange sale linking
ALTER TABLE "Sale" ADD COLUMN "exchangeFromSaleId" UUID;

ALTER TABLE "Refund"
ADD COLUMN "returnToStock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "returnedToStockAt" TIMESTAMP(3);

CREATE INDEX "Sale_exchangeFromSaleId_idx" ON "Sale"("exchangeFromSaleId");

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_exchangeFromSaleId_fkey"
FOREIGN KEY ("exchangeFromSaleId") REFERENCES "Sale"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
