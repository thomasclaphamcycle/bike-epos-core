-- CreateEnum
CREATE TYPE "BikeServiceScheduleType" AS ENUM ('GENERAL_SERVICE', 'SAFETY_CHECK', 'BRAKES', 'DRIVETRAIN', 'SUSPENSION', 'E_BIKE_SYSTEM', 'TYRES', 'OTHER');

-- CreateTable
CREATE TABLE "BikeServiceSchedule" (
    "id" UUID NOT NULL,
    "bikeId" UUID NOT NULL,
    "type" "BikeServiceScheduleType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "intervalMonths" INTEGER,
    "intervalMileage" INTEGER,
    "lastServiceAt" TIMESTAMP(3),
    "lastServiceMileage" INTEGER,
    "nextDueAt" TIMESTAMP(3),
    "nextDueMileage" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BikeServiceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BikeServiceSchedule_bikeId_isActive_idx" ON "BikeServiceSchedule"("bikeId", "isActive");

-- CreateIndex
CREATE INDEX "BikeServiceSchedule_bikeId_nextDueAt_idx" ON "BikeServiceSchedule"("bikeId", "nextDueAt");

-- CreateIndex
CREATE INDEX "BikeServiceSchedule_bikeId_nextDueMileage_idx" ON "BikeServiceSchedule"("bikeId", "nextDueMileage");

-- AddForeignKey
ALTER TABLE "BikeServiceSchedule" ADD CONSTRAINT "BikeServiceSchedule_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "CustomerBike"("id") ON DELETE CASCADE ON UPDATE CASCADE;
