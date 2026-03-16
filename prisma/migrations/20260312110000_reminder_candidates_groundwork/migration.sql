-- CreateEnum
CREATE TYPE "ReminderCandidateStatus" AS ENUM ('PENDING', 'READY', 'DISMISSED');

-- CreateTable
CREATE TABLE "ReminderCandidate" (
    "id" UUID NOT NULL,
    "customerId" UUID,
    "workshopJobId" UUID NOT NULL,
    "sourceEvent" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "ReminderCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReminderCandidate_workshopJobId_key" ON "ReminderCandidate"("workshopJobId");

-- CreateIndex
CREATE INDEX "ReminderCandidate_customerId_status_idx" ON "ReminderCandidate"("customerId", "status");

-- CreateIndex
CREATE INDEX "ReminderCandidate_status_dueAt_idx" ON "ReminderCandidate"("status", "dueAt");

-- CreateIndex
CREATE INDEX "ReminderCandidate_sourceEvent_createdAt_idx" ON "ReminderCandidate"("sourceEvent", "createdAt");

-- AddForeignKey
ALTER TABLE "ReminderCandidate" ADD CONSTRAINT "ReminderCandidate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderCandidate" ADD CONSTRAINT "ReminderCandidate_workshopJobId_fkey" FOREIGN KEY ("workshopJobId") REFERENCES "WorkshopJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
