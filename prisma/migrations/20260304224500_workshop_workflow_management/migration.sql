-- AlterTable
ALTER TABLE "WorkshopJob"
ADD COLUMN "assignedStaffId" TEXT,
ADD COLUMN "assignedStaffName" TEXT;

-- CreateEnum
CREATE TYPE "WorkshopJobNoteVisibility" AS ENUM ('INTERNAL', 'CUSTOMER');

-- CreateTable
CREATE TABLE "WorkshopJobNote" (
    "id" UUID NOT NULL,
    "workshopJobId" UUID NOT NULL,
    "authorStaffId" TEXT,
    "visibility" "WorkshopJobNoteVisibility" NOT NULL DEFAULT 'INTERNAL',
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkshopJobNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkshopJob_assignedStaffId_idx" ON "WorkshopJob"("assignedStaffId");

-- CreateIndex
CREATE INDEX "WorkshopJobNote_workshopJobId_createdAt_idx" ON "WorkshopJobNote"("workshopJobId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopJobNote_authorStaffId_idx" ON "WorkshopJobNote"("authorStaffId");

-- AddForeignKey
ALTER TABLE "WorkshopJob" ADD CONSTRAINT "WorkshopJob_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopJobNote" ADD CONSTRAINT "WorkshopJobNote_workshopJobId_fkey" FOREIGN KEY ("workshopJobId") REFERENCES "WorkshopJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopJobNote" ADD CONSTRAINT "WorkshopJobNote_authorStaffId_fkey" FOREIGN KEY ("authorStaffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
