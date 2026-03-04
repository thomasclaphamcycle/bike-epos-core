-- CreateEnum
CREATE TYPE "WorkshopJobPartStatus" AS ENUM ('PLANNED', 'USED', 'RETURNED');

-- CreateTable
CREATE TABLE "WorkshopJobPart" (
    "id" UUID NOT NULL,
    "workshopJobId" UUID NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceAtTime" INTEGER NOT NULL,
    "costPriceAtTime" INTEGER,
    "status" "WorkshopJobPartStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopJobPart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkshopJobPart_workshopJobId_createdAt_idx" ON "WorkshopJobPart"("workshopJobId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopJobPart_variantId_idx" ON "WorkshopJobPart"("variantId");

-- AddForeignKey
ALTER TABLE "WorkshopJobPart" ADD CONSTRAINT "WorkshopJobPart_workshopJobId_fkey" FOREIGN KEY ("workshopJobId") REFERENCES "WorkshopJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopJobPart" ADD CONSTRAINT "WorkshopJobPart_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
