-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "customerId" UUID,
    "bikeId" UUID,
    "workshopJobId" UUID,
    "saleId" UUID,
    "variantId" TEXT,
    "requestId" TEXT,
    "actorStaffId" TEXT,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DomainEvent_eventName_occurredAt_idx" ON "DomainEvent"("eventName", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_entityType_entityId_occurredAt_idx" ON "DomainEvent"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_customerId_occurredAt_idx" ON "DomainEvent"("customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_bikeId_occurredAt_idx" ON "DomainEvent"("bikeId", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_workshopJobId_occurredAt_idx" ON "DomainEvent"("workshopJobId", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_saleId_occurredAt_idx" ON "DomainEvent"("saleId", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_variantId_occurredAt_idx" ON "DomainEvent"("variantId", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_actorStaffId_occurredAt_idx" ON "DomainEvent"("actorStaffId", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_requestId_idx" ON "DomainEvent"("requestId");
