export const WORKSHOP_LABOUR_VARIANT_SKU = "WORKSHOP-LABOUR-SERVICE";

export type PosLineItemType = "PART" | "LABOUR";

export const toPosLineItemType = (sku: string | null | undefined): PosLineItemType =>
  sku === WORKSHOP_LABOUR_VARIANT_SKU ? "LABOUR" : "PART";
