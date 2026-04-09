CREATE UNIQUE INDEX IF NOT EXISTS "PrintJob_single_processing_per_printer_idx"
ON "PrintJob"("printerId")
WHERE "status" = 'PROCESSING';
