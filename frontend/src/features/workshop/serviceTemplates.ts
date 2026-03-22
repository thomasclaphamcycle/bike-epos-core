export type WorkshopServiceTemplateLine = {
  id: string;
  templateId: string;
  type: "LABOUR" | "PART";
  productId: string | null;
  productName: string | null;
  variantId: string | null;
  variantSku: string | null;
  variantName: string | null;
  description: string;
  qty: number;
  unitPricePence: number | null;
  resolvedUnitPricePence: number;
  lineTotalPence: number;
  isOptional: boolean;
  sortOrder: number;
  hasInventoryLink: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkshopServiceTemplate = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  defaultDurationMinutes: number | null;
  isActive: boolean;
  lineCount: number;
  lines: WorkshopServiceTemplateLine[];
  createdAt: string;
  updatedAt: string;
};

export type WorkshopServiceTemplatesResponse = {
  templates: WorkshopServiceTemplate[];
};

export const getOptionalTemplateLineIds = (template: WorkshopServiceTemplate | null | undefined) =>
  (template?.lines ?? [])
    .filter((line) => line.isOptional)
    .map((line) => line.id);

export const getDefaultSelectedOptionalLineIds = (
  template: WorkshopServiceTemplate | null | undefined,
) => getOptionalTemplateLineIds(template);

export const formatWorkshopTemplateMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;
