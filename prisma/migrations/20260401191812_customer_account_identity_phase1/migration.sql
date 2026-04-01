-- CreateEnum
CREATE TYPE "CustomerAccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "CustomerAccount" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "status" "CustomerAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastAccessLinkSentAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAccessToken" (
    "id" UUID NOT NULL,
    "customerAccountId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenLastEight" TEXT,
    "redirectPath" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccount_customerId_key" ON "CustomerAccount"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccount_email_key" ON "CustomerAccount"("email");

-- CreateIndex
CREATE INDEX "CustomerAccount_status_email_idx" ON "CustomerAccount"("status", "email");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccessToken_tokenHash_key" ON "CustomerAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CustomerAccessToken_customerAccountId_expiresAt_idx" ON "CustomerAccessToken"("customerAccountId", "expiresAt");

-- CreateIndex
CREATE INDEX "CustomerAccessToken_expiresAt_idx" ON "CustomerAccessToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "CustomerAccount" ADD CONSTRAINT "CustomerAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAccessToken" ADD CONSTRAINT "CustomerAccessToken_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
