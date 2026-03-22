-- AlterTable
ALTER TABLE "WorkshopJob" ADD COLUMN     "durationMinutes" INTEGER,
ADD COLUMN     "scheduledEndAt" TIMESTAMP(3),
ADD COLUMN     "scheduledStartAt" TIMESTAMP(3);

UPDATE "WorkshopJob"
SET
    "scheduledStartAt" = date_trunc('day', "scheduledDate") + INTERVAL '10 hours',
    "durationMinutes" = 60,
    "scheduledEndAt" = date_trunc('day', "scheduledDate") + INTERVAL '11 hours'
WHERE "scheduledDate" IS NOT NULL;

-- CreateTable
CREATE TABLE "WorkshopWorkingHours" (
    "id" UUID NOT NULL,
    "staffId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopWorkingHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkshopTimeOff" (
    "id" UUID NOT NULL,
    "staffId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopTimeOff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkshopWorkingHours_staffId_dayOfWeek_idx" ON "WorkshopWorkingHours"("staffId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopWorkingHours_staffId_dayOfWeek_key" ON "WorkshopWorkingHours"("staffId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "WorkshopTimeOff_staffId_startAt_idx" ON "WorkshopTimeOff"("staffId", "startAt");

-- CreateIndex
CREATE INDEX "WorkshopTimeOff_staffId_endAt_idx" ON "WorkshopTimeOff"("staffId", "endAt");

-- CreateIndex
CREATE INDEX "WorkshopTimeOff_startAt_endAt_idx" ON "WorkshopTimeOff"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "WorkshopJob_scheduledStartAt_idx" ON "WorkshopJob"("scheduledStartAt");

-- CreateIndex
CREATE INDEX "WorkshopJob_assignedStaffId_scheduledStartAt_idx" ON "WorkshopJob"("assignedStaffId", "scheduledStartAt");

-- AddForeignKey
ALTER TABLE "WorkshopWorkingHours" ADD CONSTRAINT "WorkshopWorkingHours_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopTimeOff" ADD CONSTRAINT "WorkshopTimeOff_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
