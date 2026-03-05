-- M40: Receipts v1 (issuance records + printable metadata/settings).
CREATE TABLE "ReceiptSettings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "shopName" TEXT NOT NULL DEFAULT 'Bike EPOS',
  "shopAddress" TEXT NOT NULL DEFAULT '123 Service Lane',
  "vatNumber" TEXT,
  "footerText" TEXT DEFAULT 'Thank you for your custom.',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReceiptSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ReceiptSettings" ("id") VALUES (1)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "ReceiptCounter" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "nextValue" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReceiptCounter_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ReceiptCounter" ("id", "nextValue") VALUES (1, 0)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "Receipt" (
  "id" UUID NOT NULL,
  "saleId" UUID,
  "refundId" UUID,
  "receiptNumber" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedByStaffId" TEXT,
  "shopName" TEXT NOT NULL,
  "shopAddress" TEXT NOT NULL,
  "vatNumber" TEXT,
  "footerText" TEXT,
  CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Receipt_saleId_key" ON "Receipt"("saleId");
CREATE UNIQUE INDEX "Receipt_refundId_key" ON "Receipt"("refundId");
CREATE UNIQUE INDEX "Receipt_receiptNumber_key" ON "Receipt"("receiptNumber");
CREATE INDEX "Receipt_issuedAt_idx" ON "Receipt"("issuedAt");
CREATE INDEX "Receipt_issuedByStaffId_idx" ON "Receipt"("issuedByStaffId");

ALTER TABLE "Receipt"
  ADD CONSTRAINT "Receipt_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Receipt"
  ADD CONSTRAINT "Receipt_refundId_fkey"
  FOREIGN KEY ("refundId") REFERENCES "PaymentRefund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Receipt"
  ADD CONSTRAINT "Receipt_issuedByStaffId_fkey"
  FOREIGN KEY ("issuedByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
