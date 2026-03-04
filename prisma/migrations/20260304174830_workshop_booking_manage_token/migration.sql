-- AlterTable
ALTER TABLE "WorkshopJob" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "manageToken" TEXT,
ADD COLUMN     "manageTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopJob_manageToken_key" ON "WorkshopJob"("manageToken");

