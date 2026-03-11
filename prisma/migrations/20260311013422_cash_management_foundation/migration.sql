-- CreateEnum
CREATE TYPE "CashMovementReason" AS ENUM ('BANK_DEPOSIT', 'SAFE_DROP', 'SUPPLIER_PAYMENT', 'PETTY_EXPENSE', 'OTHER');

-- AlterTable
ALTER TABLE "CashMovement" ADD COLUMN     "reason" "CashMovementReason",
ADD COLUMN     "receiptImageUrl" TEXT;

-- CreateTable
CREATE TABLE "CashReceiptUploadToken" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "cashMovementId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashReceiptUploadToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashReceiptUploadToken_token_key" ON "CashReceiptUploadToken"("token");

-- CreateIndex
CREATE INDEX "CashReceiptUploadToken_cashMovementId_idx" ON "CashReceiptUploadToken"("cashMovementId");

-- CreateIndex
CREATE INDEX "CashReceiptUploadToken_expiresAt_idx" ON "CashReceiptUploadToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "CashReceiptUploadToken" ADD CONSTRAINT "CashReceiptUploadToken_cashMovementId_fkey" FOREIGN KEY ("cashMovementId") REFERENCES "CashMovement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
