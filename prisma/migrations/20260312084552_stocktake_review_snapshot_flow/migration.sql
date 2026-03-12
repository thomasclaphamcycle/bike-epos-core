-- AlterTable
ALTER TABLE "Stocktake" ADD COLUMN     "reviewRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StocktakeLine" ADD COLUMN     "expectedQtySnapshot" INTEGER;
