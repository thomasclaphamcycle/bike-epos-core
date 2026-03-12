-- CreateTable
CREATE TABLE "SupplierProductLink" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "variantId" TEXT NOT NULL,
    "supplierProductCode" TEXT,
    "supplierCostPence" INTEGER,
    "preferredSupplier" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProductLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierProductLink_supplierId_isActive_idx" ON "SupplierProductLink"("supplierId", "isActive");

-- CreateIndex
CREATE INDEX "SupplierProductLink_variantId_isActive_idx" ON "SupplierProductLink"("variantId", "isActive");

-- CreateIndex
CREATE INDEX "SupplierProductLink_variantId_preferredSupplier_isActive_idx" ON "SupplierProductLink"("variantId", "preferredSupplier", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProductLink_supplierId_variantId_key" ON "SupplierProductLink"("supplierId", "variantId");

-- AddForeignKey
ALTER TABLE "SupplierProductLink" ADD CONSTRAINT "SupplierProductLink_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductLink" ADD CONSTRAINT "SupplierProductLink_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
