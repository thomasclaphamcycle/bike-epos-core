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
  pricingMode: "STANDARD_SERVICE" | "FIXED_PRICE_SERVICE";
  targetTotalPricePence: number | null;
  isActive: boolean;
  lineCount: number;
  lines: WorkshopServiceTemplateLine[];
  createdAt: string;
  updatedAt: string;
};

export type WorkshopServiceTemplatesResponse = {
  templates: WorkshopServiceTemplate[];
};

export type WorkshopServiceTemplateApplyResponse = {
  jobId: string;
  appliedLineCount: number;
  pricingEffect: {
    pricingMode: "STANDARD_SERVICE" | "FIXED_PRICE_SERVICE";
    targetTotalPricePence: number | null;
    fixedPriceActivated: boolean;
    adjustmentLineId: string | null;
  };
  durationEffect: {
    templateDefaultDurationMinutes: number | null;
    appliedDurationMinutes: number | null;
    durationUpdated: boolean;
    timedScheduleUpdated: boolean;
    reason:
      | "template_has_no_default_duration"
      | "job_duration_already_set"
      | "unscheduled_duration_set"
      | "scheduled_duration_backfilled";
  };
};

export const getOptionalTemplateLineIds = (template: WorkshopServiceTemplate | null | undefined) =>
  (template?.lines ?? [])
    .filter((line) => line.isOptional)
    .map((line) => line.id);

export const getDefaultSelectedOptionalLineIds = (
  template: WorkshopServiceTemplate | null | undefined,
) => getOptionalTemplateLineIds(template);

export const formatWorkshopTemplateMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;
