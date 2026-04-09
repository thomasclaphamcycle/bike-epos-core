-- CreateEnum
CREATE TYPE "PrintJobWorkflowType" AS ENUM ('RECEIPT_PRINT', 'SHIPMENT_LABEL_PRINT', 'PRODUCT_LABEL_PRINT', 'BIKE_TAG_PRINT');

-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" UUID NOT NULL,
    "workflowType" "PrintJobWorkflowType" NOT NULL,
    "printerId" UUID NOT NULL,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "payload" JSONB NOT NULL,
    "documentLabel" TEXT,
    "sourceEntityType" TEXT,
    "sourceEntityId" TEXT,
    "createdByStaffId" TEXT,
    "lastError" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorRetryable" BOOLEAN,
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrintJob_printerId_status_nextAttemptAt_createdAt_idx" ON "PrintJob"("printerId", "status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX "PrintJob_workflowType_status_createdAt_idx" ON "PrintJob"("workflowType", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PrintJob_status_nextAttemptAt_createdAt_idx" ON "PrintJob"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX "PrintJob_sourceEntityType_sourceEntityId_createdAt_idx" ON "PrintJob"("sourceEntityType", "sourceEntityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_single_processing_per_printer_idx"
ON "PrintJob"("printerId")
WHERE "status" = 'PROCESSING';

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
