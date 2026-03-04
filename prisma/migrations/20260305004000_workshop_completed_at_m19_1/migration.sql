-- M19.1 workshop completion tracking
ALTER TABLE "WorkshopJob"
ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE INDEX "WorkshopJob_status_completedAt_idx"
ON "WorkshopJob"("status", "completedAt");
