-- CreateEnum
CREATE TYPE "RotaPeriodStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RotaShiftType" AS ENUM ('FULL_DAY', 'HALF_DAY_AM', 'HALF_DAY_PM', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "RotaAssignmentSource" AS ENUM ('MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "RotaClosedDayType" AS ENUM ('SCHEDULED_CLOSED', 'BANK_HOLIDAY', 'CUSTOM');

-- CreateTable
CREATE TABLE "RotaPeriod" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "startsOn" TEXT NOT NULL,
    "endsOn" TEXT NOT NULL,
    "status" "RotaPeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RotaPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotaAssignment" (
    "id" UUID NOT NULL,
    "rotaPeriodId" UUID NOT NULL,
    "staffId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "shiftType" "RotaShiftType" NOT NULL,
    "source" "RotaAssignmentSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "rawValue" TEXT,
    "importBatchKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RotaAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotaClosedDay" (
    "id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "type" "RotaClosedDayType" NOT NULL DEFAULT 'CUSTOM',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RotaClosedDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RotaPeriod_status_startsOn_idx" ON "RotaPeriod"("status", "startsOn");

-- CreateIndex
CREATE UNIQUE INDEX "RotaPeriod_startsOn_endsOn_key" ON "RotaPeriod"("startsOn", "endsOn");

-- CreateIndex
CREATE INDEX "RotaAssignment_date_shiftType_idx" ON "RotaAssignment"("date", "shiftType");

-- CreateIndex
CREATE INDEX "RotaAssignment_rotaPeriodId_date_idx" ON "RotaAssignment"("rotaPeriodId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RotaAssignment_staffId_date_key" ON "RotaAssignment"("staffId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RotaClosedDay_date_key" ON "RotaClosedDay"("date");

-- CreateIndex
CREATE INDEX "RotaClosedDay_type_date_idx" ON "RotaClosedDay"("type", "date");

-- AddForeignKey
ALTER TABLE "RotaAssignment" ADD CONSTRAINT "RotaAssignment_rotaPeriodId_fkey" FOREIGN KEY ("rotaPeriodId") REFERENCES "RotaPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotaAssignment" ADD CONSTRAINT "RotaAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
