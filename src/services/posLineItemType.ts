export const WORKSHOP_LABOUR_VARIANT_SKU = "WORKSHOP-LABOUR-SERVICE";
export const WORKSHOP_SERVICE_TEMPLATE_LABOUR_SKU_PREFIX = `${WORKSHOP_LABOUR_VARIANT_SKU}-`;

export type PosLineItemType = "PART" | "LABOUR";

export const toPosLineItemType = (sku: string | null | undefined): PosLineItemType =>
  sku === WORKSHOP_LABOUR_VARIANT_SKU || sku?.startsWith(WORKSHOP_SERVICE_TEMPLATE_LABOUR_SKU_PREFIX)
    ? "LABOUR"
    : "PART";
