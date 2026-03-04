-- CreateEnum
CREATE TYPE "WorkshopDepositStatus" AS ENUM ('NOT_REQUIRED', 'REQUIRED', 'PAID');

-- AlterTable
ALTER TABLE "BookingSettings"
ADD COLUMN "defaultDepositPence" INTEGER NOT NULL DEFAULT 1000;

-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "workshopJobId" UUID,
ALTER COLUMN "saleId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Sale"
ADD COLUMN "workshopJobId" UUID,
ALTER COLUMN "basketId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "WorkshopJob"
ADD COLUMN "depositRequiredPence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "depositStatus" "WorkshopDepositStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_saleId_fkey";
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_basketId_fkey";

-- CreateIndex
CREATE INDEX "Payment_workshopJobId_idx" ON "Payment"("workshopJobId");
CREATE INDEX "Sale_workshopJobId_idx" ON "Sale"("workshopJobId");
CREATE UNIQUE INDEX "Sale_workshopJobId_key" ON "Sale"("workshopJobId");

-- AddForeignKey
ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_saleId_fkey"
FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_workshopJobId_fkey"
FOREIGN KEY ("workshopJobId") REFERENCES "WorkshopJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_basketId_fkey"
FOREIGN KEY ("basketId") REFERENCES "Basket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_workshopJobId_fkey"
FOREIGN KEY ("workshopJobId") REFERENCES "WorkshopJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
