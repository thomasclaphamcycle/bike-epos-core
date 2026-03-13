-- CreateEnum
CREATE TYPE "HireAssetStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'ON_HIRE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "HireBookingStatus" AS ENUM ('RESERVED', 'CHECKED_OUT', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HireDepositStatus" AS ENUM ('NONE', 'HELD', 'RETURNED', 'KEPT');

-- CreateTable
CREATE TABLE "HireAsset" (
    "id" UUID NOT NULL,
    "variantId" TEXT NOT NULL,
    "assetTag" TEXT NOT NULL,
    "displayName" TEXT,
    "notes" TEXT,
    "status" "HireAssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HireAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HireBooking" (
    "id" UUID NOT NULL,
    "hireAssetId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "status" "HireBookingStatus" NOT NULL DEFAULT 'RESERVED',
    "depositStatus" "HireDepositStatus" NOT NULL DEFAULT 'NONE',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "dueBackAt" TIMESTAMP(3) NOT NULL,
    "checkedOutAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "hirePricePence" INTEGER NOT NULL DEFAULT 0,
    "depositPence" INTEGER NOT NULL DEFAULT 0,
    "depositHeldPence" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdByStaffId" TEXT,
    "checkedOutByStaffId" TEXT,
    "returnedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HireBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HireAsset_assetTag_key" ON "HireAsset"("assetTag");

-- CreateIndex
CREATE INDEX "HireAsset_variantId_idx" ON "HireAsset"("variantId");

-- CreateIndex
CREATE INDEX "HireAsset_status_createdAt_idx" ON "HireAsset"("status", "createdAt");

-- CreateIndex
CREATE INDEX "HireBooking_hireAssetId_status_idx" ON "HireBooking"("hireAssetId", "status");

-- CreateIndex
CREATE INDEX "HireBooking_customerId_status_idx" ON "HireBooking"("customerId", "status");

-- CreateIndex
CREATE INDEX "HireBooking_status_dueBackAt_idx" ON "HireBooking"("status", "dueBackAt");

-- AddForeignKey
ALTER TABLE "HireAsset" ADD CONSTRAINT "HireAsset_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HireBooking" ADD CONSTRAINT "HireBooking_hireAssetId_fkey" FOREIGN KEY ("hireAssetId") REFERENCES "HireAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HireBooking" ADD CONSTRAINT "HireBooking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HireBooking" ADD CONSTRAINT "HireBooking_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HireBooking" ADD CONSTRAINT "HireBooking_checkedOutByStaffId_fkey" FOREIGN KEY ("checkedOutByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HireBooking" ADD CONSTRAINT "HireBooking_returnedByStaffId_fkey" FOREIGN KEY ("returnedByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
