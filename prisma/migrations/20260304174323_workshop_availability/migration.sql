-- CreateEnum
CREATE TYPE "WorkshopJobStatus" AS ENUM ('BOOKING_MADE', 'BIKE_ARRIVED', 'WAITING_FOR_APPROVAL', 'APPROVED', 'WAITING_FOR_PARTS', 'ON_HOLD', 'BIKE_READY', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkshopJobSource" AS ENUM ('ONLINE', 'IN_STORE');

-- CreateTable
CREATE TABLE "WorkshopJob" (
    "id" UUID NOT NULL,
    "customerId" UUID,
    "status" "WorkshopJobStatus" NOT NULL DEFAULT 'BOOKING_MADE',
    "scheduledDate" TIMESTAMP(3),
    "source" "WorkshopJobSource" NOT NULL DEFAULT 'IN_STORE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "minBookableDate" TIMESTAMP(3) NOT NULL,
    "maxBookingsPerDay" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkshopJob_scheduledDate_idx" ON "WorkshopJob"("scheduledDate");

-- CreateIndex
CREATE INDEX "WorkshopJob_status_idx" ON "WorkshopJob"("status");

-- AddForeignKey
ALTER TABLE "WorkshopJob" ADD CONSTRAINT "WorkshopJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
