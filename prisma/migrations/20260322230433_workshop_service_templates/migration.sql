-- CreateTable
CREATE TABLE "WorkshopServiceTemplate" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "defaultDurationMinutes" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopServiceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkshopServiceTemplateLine" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "type" "WorkshopJobLineType" NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPricePence" INTEGER,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopServiceTemplateLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkshopServiceTemplate_isActive_name_idx" ON "WorkshopServiceTemplate"("isActive", "name");

-- CreateIndex
CREATE INDEX "WorkshopServiceTemplate_category_isActive_idx" ON "WorkshopServiceTemplate"("category", "isActive");

-- CreateIndex
CREATE INDEX "WorkshopServiceTemplateLine_templateId_sortOrder_idx" ON "WorkshopServiceTemplateLine"("templateId", "sortOrder");

-- CreateIndex
CREATE INDEX "WorkshopServiceTemplateLine_productId_idx" ON "WorkshopServiceTemplateLine"("productId");

-- CreateIndex
CREATE INDEX "WorkshopServiceTemplateLine_variantId_idx" ON "WorkshopServiceTemplateLine"("variantId");

-- AddForeignKey
ALTER TABLE "WorkshopServiceTemplateLine" ADD CONSTRAINT "WorkshopServiceTemplateLine_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkshopServiceTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopServiceTemplateLine" ADD CONSTRAINT "WorkshopServiceTemplateLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopServiceTemplateLine" ADD CONSTRAINT "WorkshopServiceTemplateLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
