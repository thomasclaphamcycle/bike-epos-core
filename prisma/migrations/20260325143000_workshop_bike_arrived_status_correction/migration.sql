ALTER TYPE "WorkshopJobStatus" RENAME TO "WorkshopJobStatus_old";

CREATE TYPE "WorkshopJobStatus" AS ENUM (
  'BOOKED',
  'BIKE_ARRIVED',
  'IN_PROGRESS',
  'WAITING_FOR_APPROVAL',
  'WAITING_FOR_PARTS',
  'ON_HOLD',
  'READY_FOR_COLLECTION',
  'COMPLETED',
  'CANCELLED'
);

ALTER TABLE "WorkshopJob"
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "WorkshopJob"
ALTER COLUMN "status" TYPE "WorkshopJobStatus"
USING ("status"::text::"WorkshopJobStatus");

ALTER TABLE "WorkshopJob"
ALTER COLUMN "status" SET DEFAULT 'BOOKED';

UPDATE "WorkshopJob" AS job
SET "status" = CASE
  WHEN
    job."assignedStaffId" IS NOT NULL
    OR job."scheduledStartAt" IS NOT NULL
    OR job."scheduledEndAt" IS NOT NULL
    OR job."durationMinutes" IS NOT NULL
    OR job."finalizedBasketId" IS NOT NULL
    OR job."completedAt" IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM "WorkshopJobPart" AS part
      WHERE part."workshopJobId" = job."id"
        AND part."status" IN ('USED', 'RETURNED')
    )
    THEN 'IN_PROGRESS'::"WorkshopJobStatus"
  WHEN
    job."bikeId" IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(job."bikeDescription", '')), '') IS NOT NULL
    OR job."source" = 'IN_STORE'
    THEN 'BIKE_ARRIVED'::"WorkshopJobStatus"
  ELSE 'BOOKED'::"WorkshopJobStatus"
END
WHERE job."status" = 'IN_PROGRESS'::"WorkshopJobStatus";

DROP TYPE "WorkshopJobStatus_old";
