-- CreateEnum
CREATE TYPE "WorkshopAttachmentVisibility" AS ENUM ('INTERNAL', 'CUSTOMER');

-- CreateTable
CREATE TABLE "WorkshopAttachment" (
    "id" UUID NOT NULL,
    "workshopJobId" UUID NOT NULL,
    "uploadedByStaffId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "visibility" "WorkshopAttachmentVisibility" NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkshopAttachment_workshopJobId_createdAt_idx" ON "WorkshopAttachment"("workshopJobId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopAttachment_workshopJobId_visibility_createdAt_idx" ON "WorkshopAttachment"("workshopJobId", "visibility", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopAttachment_uploadedByStaffId_idx" ON "WorkshopAttachment"("uploadedByStaffId");

-- AddForeignKey
ALTER TABLE "WorkshopAttachment" ADD CONSTRAINT "WorkshopAttachment_workshopJobId_fkey" FOREIGN KEY ("workshopJobId") REFERENCES "WorkshopJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopAttachment" ADD CONSTRAINT "WorkshopAttachment_uploadedByStaffId_fkey" FOREIGN KEY ("uploadedByStaffId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
