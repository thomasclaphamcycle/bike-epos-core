-- Dojo Pay at Counter terminal-session tracking.
CREATE TYPE "CardTerminalProvider" AS ENUM ('DOJO');

CREATE TYPE "CardTerminalSessionStatus" AS ENUM (
  'CREATED',
  'INITIATED',
  'SIGNATURE_VERIFICATION_REQUIRED',
  'AUTHORIZED',
  'CAPTURED',
  'DECLINED',
  'CANCELED',
  'EXPIRED',
  'FAILED',
  'UNKNOWN'
);

CREATE TABLE "CardTerminalSession" (
  "id" UUID NOT NULL,
  "provider" "CardTerminalProvider" NOT NULL DEFAULT 'DOJO',
  "status" "CardTerminalSessionStatus" NOT NULL DEFAULT 'CREATED',
  "sessionType" TEXT NOT NULL DEFAULT 'Sale',
  "saleId" UUID NOT NULL,
  "corePaymentIntentId" UUID,
  "saleTenderId" UUID,
  "providerPaymentIntentId" TEXT,
  "providerTerminalSessionId" TEXT,
  "terminalId" TEXT NOT NULL,
  "amountPence" INTEGER NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'GBP',
  "providerStatus" TEXT,
  "providerReference" TEXT,
  "notificationEvents" JSONB,
  "customerReceipt" JSONB,
  "merchantReceipt" JSONB,
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "createdByStaffId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "CardTerminalSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CardTerminalSession_providerTerminalSessionId_key"
  ON "CardTerminalSession"("providerTerminalSessionId");

CREATE UNIQUE INDEX "CardTerminalSession_saleTenderId_key"
  ON "CardTerminalSession"("saleTenderId");

CREATE INDEX "CardTerminalSession_saleId_createdAt_idx"
  ON "CardTerminalSession"("saleId", "createdAt");

CREATE INDEX "CardTerminalSession_provider_status_createdAt_idx"
  ON "CardTerminalSession"("provider", "status", "createdAt");

CREATE INDEX "CardTerminalSession_terminalId_status_idx"
  ON "CardTerminalSession"("terminalId", "status");

CREATE INDEX "CardTerminalSession_corePaymentIntentId_idx"
  ON "CardTerminalSession"("corePaymentIntentId");

ALTER TABLE "CardTerminalSession"
  ADD CONSTRAINT "CardTerminalSession_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CardTerminalSession"
  ADD CONSTRAINT "CardTerminalSession_corePaymentIntentId_fkey"
  FOREIGN KEY ("corePaymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CardTerminalSession"
  ADD CONSTRAINT "CardTerminalSession_saleTenderId_fkey"
  FOREIGN KEY ("saleTenderId") REFERENCES "SaleTender"("id") ON DELETE SET NULL ON UPDATE CASCADE;
