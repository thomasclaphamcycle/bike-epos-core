-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorRole" TEXT,
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- RenameIndex
DO $$
BEGIN
  IF to_regclass('"CreditLedgerEntry_creditAccountId_sourceType_sourceRef_amountPe"') IS NOT NULL
     AND to_regclass('"CreditLedgerEntry_creditAccountId_sourceType_sourceRef_amou_key"') IS NULL THEN
    EXECUTE 'ALTER INDEX "CreditLedgerEntry_creditAccountId_sourceType_sourceRef_amountPe" RENAME TO "CreditLedgerEntry_creditAccountId_sourceType_sourceRef_amou_key"';
  END IF;
END $$;
