-- M37: till / cash-up / end-of-day models
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "CashMovementType" AS ENUM ('FLOAT_IN', 'PAID_IN', 'PAID_OUT', 'CASH_SALE', 'CASH_REFUND');

CREATE TABLE "CashSession" (
  "id" UUID NOT NULL,
  "businessDate" TIMESTAMP(3) NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "openedByStaffId" TEXT,
  "closedByStaffId" TEXT,
  "openingFloatPence" INTEGER NOT NULL,
  "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CashMovement" (
  "id" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "type" "CashMovementType" NOT NULL,
  "amountPence" INTEGER NOT NULL,
  "ref" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByStaffId" TEXT,

  CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CashCount" (
  "id" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "countedCashPence" INTEGER NOT NULL,
  "notes" TEXT,
  "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "countedByStaffId" TEXT,

  CONSTRAINT "CashCount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashMovement_sessionId_type_ref_key" ON "CashMovement"("sessionId", "type", "ref");
CREATE UNIQUE INDEX "CashCount_sessionId_key" ON "CashCount"("sessionId");

CREATE INDEX "CashSession_businessDate_status_idx" ON "CashSession"("businessDate", "status");
CREATE INDEX "CashSession_openedByStaffId_idx" ON "CashSession"("openedByStaffId");
CREATE INDEX "CashSession_closedByStaffId_idx" ON "CashSession"("closedByStaffId");

CREATE INDEX "CashMovement_sessionId_createdAt_idx" ON "CashMovement"("sessionId", "createdAt");
CREATE INDEX "CashMovement_type_createdAt_idx" ON "CashMovement"("type", "createdAt");
CREATE INDEX "CashMovement_createdByStaffId_idx" ON "CashMovement"("createdByStaffId");

CREATE INDEX "CashCount_countedAt_idx" ON "CashCount"("countedAt");
CREATE INDEX "CashCount_countedByStaffId_idx" ON "CashCount"("countedByStaffId");

ALTER TABLE "CashSession"
  ADD CONSTRAINT "CashSession_openedByStaffId_fkey"
  FOREIGN KEY ("openedByStaffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashSession"
  ADD CONSTRAINT "CashSession_closedByStaffId_fkey"
  FOREIGN KEY ("closedByStaffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashMovement"
  ADD CONSTRAINT "CashMovement_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "CashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CashMovement"
  ADD CONSTRAINT "CashMovement_createdByStaffId_fkey"
  FOREIGN KEY ("createdByStaffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashCount"
  ADD CONSTRAINT "CashCount_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "CashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CashCount"
  ADD CONSTRAINT "CashCount_countedByStaffId_fkey"
  FOREIGN KEY ("countedByStaffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
