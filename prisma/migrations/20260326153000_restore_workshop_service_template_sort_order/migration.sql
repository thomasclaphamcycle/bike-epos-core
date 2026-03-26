ALTER TABLE "WorkshopServiceTemplate"
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

WITH ranked_templates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY name ASC, "createdAt" ASC, id ASC) - 1 AS next_sort_order
  FROM "WorkshopServiceTemplate"
)
UPDATE "WorkshopServiceTemplate" AS template
SET "sortOrder" = ranked_templates.next_sort_order
FROM ranked_templates
WHERE ranked_templates.id = template.id;

CREATE INDEX "WorkshopServiceTemplate_sortOrder_name_idx"
ON "WorkshopServiceTemplate"("sortOrder", name);
