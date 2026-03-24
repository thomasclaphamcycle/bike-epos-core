-- CreateEnum
CREATE TYPE "WorkshopServicePricingMode" AS ENUM ('STANDARD_SERVICE', 'FIXED_PRICE_SERVICE');

-- AlterTable
ALTER TABLE "WorkshopJob" ADD COLUMN     "servicePricingAdjustmentLineId" TEXT,
ADD COLUMN     "servicePricingMode" "WorkshopServicePricingMode",
ADD COLUMN     "serviceTargetTotalPence" INTEGER;

-- AlterTable
ALTER TABLE "WorkshopServiceTemplate" ADD COLUMN     "pricingMode" "WorkshopServicePricingMode" NOT NULL DEFAULT 'STANDARD_SERVICE',
ADD COLUMN     "targetTotalPricePence" INTEGER;
