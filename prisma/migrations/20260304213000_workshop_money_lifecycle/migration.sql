-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('DEPOSIT', 'FINAL', 'ADJUSTMENT', 'CREDIT_APPLIED', 'CREDIT_ISSUED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('RECORDED', 'PROCESSOR_PENDING', 'PROCESSOR_SUCCEEDED', 'PROCESSOR_FAILED');

-- CreateEnum
CREATE TYPE "CancellationOutcome" AS ENUM ('REFUND_DEPOSIT', 'FORFEIT_DEPOSIT', 'CONVERT_TO_CREDIT', 'NO_DEPOSIT');

-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "purpose" "PaymentPurpose" NOT NULL DEFAULT 'FINAL',
ADD COLUMN "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN "refundedTotalPence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'RECORDED',
    "processorRefundId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditAccount" (
    "id" UUID NOT NULL,
    "customerId" UUID,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedgerEntry" (
    "id" UUID NOT NULL,
    "creditAccountId" UUID NOT NULL,
    "paymentId" UUID,
    "amountPence" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkshopCancellation" (
    "id" UUID NOT NULL,
    "workshopJobId" UUID NOT NULL,
    "outcome" "CancellationOutcome" NOT NULL,
    "notes" TEXT,
    "paymentRefundId" UUID,
    "creditAccountId" UUID,
    "creditLedgerEntryId" UUID,
    "cancelledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkshopCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_purpose_createdAt_idx" ON "Payment"("purpose", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRefund_paymentId_createdAt_idx" ON "PaymentRefund"("paymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_paymentId_idempotencyKey_key" ON "PaymentRefund"("paymentId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CreditAccount_customerId_key" ON "CreditAccount"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditAccount_email_phone_key" ON "CreditAccount"("email", "phone");

-- CreateIndex
CREATE INDEX "CreditAccount_email_idx" ON "CreditAccount"("email");

-- CreateIndex
CREATE INDEX "CreditAccount_phone_idx" ON "CreditAccount"("phone");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_creditAccountId_createdAt_idx" ON "CreditLedgerEntry"("creditAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_sourceType_sourceRef_idx" ON "CreditLedgerEntry"("sourceType", "sourceRef");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedgerEntry_creditAccountId_idempotencyKey_key" ON "CreditLedgerEntry"("creditAccountId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedgerEntry_creditAccountId_sourceType_sourceRef_amou_key" ON "CreditLedgerEntry"("creditAccountId", "sourceType", "sourceRef", "amountPence");

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopCancellation_workshopJobId_key" ON "WorkshopCancellation"("workshopJobId");

-- CreateIndex
CREATE INDEX "WorkshopCancellation_cancelledAt_idx" ON "WorkshopCancellation"("cancelledAt");

-- CreateIndex
CREATE INDEX "WorkshopCancellation_outcome_cancelledAt_idx" ON "WorkshopCancellation"("outcome", "cancelledAt");

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_creditAccountId_fkey" FOREIGN KEY ("creditAccountId") REFERENCES "CreditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopCancellation" ADD CONSTRAINT "WorkshopCancellation_workshopJobId_fkey" FOREIGN KEY ("workshopJobId") REFERENCES "WorkshopJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopCancellation" ADD CONSTRAINT "WorkshopCancellation_paymentRefundId_fkey" FOREIGN KEY ("paymentRefundId") REFERENCES "PaymentRefund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopCancellation" ADD CONSTRAINT "WorkshopCancellation_creditAccountId_fkey" FOREIGN KEY ("creditAccountId") REFERENCES "CreditAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopCancellation" ADD CONSTRAINT "WorkshopCancellation_creditLedgerEntryId_fkey" FOREIGN KEY ("creditLedgerEntryId") REFERENCES "CreditLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
