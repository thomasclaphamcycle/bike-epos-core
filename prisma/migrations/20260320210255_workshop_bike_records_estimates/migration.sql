-- CreateEnum
CREATE TYPE "WorkshopEstimateStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "WorkshopJob" ADD COLUMN     "bikeId" UUID;

-- CreateTable
CREATE TABLE "CustomerBike" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "label" TEXT,
    "make" TEXT,
    "model" TEXT,
    "colour" TEXT,
    "frameNumber" TEXT,
    "serialNumber" TEXT,
    "registrationNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerBike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkshopEstimate" (
    "id" UUID NOT NULL,
    "workshopJobId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "WorkshopEstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "labourTotalPence" INTEGER NOT NULL DEFAULT 0,
    "partsTotalPence" INTEGER NOT NULL DEFAULT 0,
    "subtotalPence" INTEGER NOT NULL DEFAULT 0,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "createdByStaffId" TEXT,
    "decisionByStaffId" TEXT,
    "requestedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkshopEstimateLine" (
    "id" UUID NOT NULL,
    "estimateId" UUID NOT NULL,
    "workshopJobLineId" UUID,
    "sortOrder" INTEGER NOT NULL,
    "type" "WorkshopJobLineType" NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPricePence" INTEGER NOT NULL,
    "lineTotalPence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkshopEstimateLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerBike_customerId_createdAt_idx" ON "CustomerBike"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerBike_frameNumber_idx" ON "CustomerBike"("frameNumber");

-- CreateIndex
CREATE INDEX "CustomerBike_serialNumber_idx" ON "CustomerBike"("serialNumber");

-- CreateIndex
CREATE INDEX "CustomerBike_registrationNumber_idx" ON "CustomerBike"("registrationNumber");

-- CreateIndex
CREATE INDEX "WorkshopEstimate_workshopJobId_createdAt_idx" ON "WorkshopEstimate"("workshopJobId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopEstimate_workshopJobId_status_idx" ON "WorkshopEstimate"("workshopJobId", "status");

-- CreateIndex
CREATE INDEX "WorkshopEstimate_createdByStaffId_idx" ON "WorkshopEstimate"("createdByStaffId");

-- CreateIndex
CREATE INDEX "WorkshopEstimate_decisionByStaffId_idx" ON "WorkshopEstimate"("decisionByStaffId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopEstimate_workshopJobId_version_key" ON "WorkshopEstimate"("workshopJobId", "version");

-- CreateIndex
CREATE INDEX "WorkshopEstimateLine_estimateId_sortOrder_idx" ON "WorkshopEstimateLine"("estimateId", "sortOrder");

-- CreateIndex
CREATE INDEX "WorkshopEstimateLine_workshopJobLineId_idx" ON "WorkshopEstimateLine"("workshopJobLineId");

-- CreateIndex
CREATE INDEX "WorkshopJob_bikeId_idx" ON "WorkshopJob"("bikeId");

-- AddForeignKey
ALTER TABLE "CustomerBike" ADD CONSTRAINT "CustomerBike_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopJob" ADD CONSTRAINT "WorkshopJob_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "CustomerBike"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopEstimate" ADD CONSTRAINT "WorkshopEstimate_workshopJobId_fkey" FOREIGN KEY ("workshopJobId") REFERENCES "WorkshopJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopEstimate" ADD CONSTRAINT "WorkshopEstimate_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopEstimate" ADD CONSTRAINT "WorkshopEstimate_decisionByStaffId_fkey" FOREIGN KEY ("decisionByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopEstimateLine" ADD CONSTRAINT "WorkshopEstimateLine_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "WorkshopEstimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopEstimateLine" ADD CONSTRAINT "WorkshopEstimateLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopEstimateLine" ADD CONSTRAINT "WorkshopEstimateLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
