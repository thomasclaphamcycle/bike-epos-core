-- AlterTable
ALTER TABLE "ReminderCandidate"
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedByStaffId" TEXT;

-- CreateIndex
CREATE INDEX "ReminderCandidate_reviewedAt_idx" ON "ReminderCandidate"("reviewedAt");
