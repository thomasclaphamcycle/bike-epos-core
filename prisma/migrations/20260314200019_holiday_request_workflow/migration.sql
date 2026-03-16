-- CreateEnum
CREATE TYPE "HolidayRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "RotaAssignmentSource" ADD VALUE 'HOLIDAY_APPROVED';

-- CreateTable
CREATE TABLE "HolidayRequest" (
    "id" UUID NOT NULL,
    "staffId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "status" "HolidayRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestNotes" TEXT,
    "decisionNotes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HolidayRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HolidayRequest_staffId_status_startDate_idx" ON "HolidayRequest"("staffId", "status", "startDate");

-- CreateIndex
CREATE INDEX "HolidayRequest_status_startDate_idx" ON "HolidayRequest"("status", "startDate");

-- CreateIndex
CREATE INDEX "HolidayRequest_reviewedByUserId_idx" ON "HolidayRequest"("reviewedByUserId");

-- AddForeignKey
ALTER TABLE "HolidayRequest" ADD CONSTRAINT "HolidayRequest_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolidayRequest" ADD CONSTRAINT "HolidayRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
