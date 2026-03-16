export type VelocitySignalRow = {
  productId: string;
  productName: string;
  currentOnHand: number;
  quantitySold: number;
  velocityPer30Days: number;
  lastSoldAt: string | null;
};

export type ReorderUrgency = "Low" | "Reorder Soon" | "Reorder Now";

export type ReorderSuggestionRow = VelocitySignalRow & {
  targetStockQty: number;
  suggestedReorderQty: number;
  daysOfCover: number | null;
  urgency: ReorderUrgency;
};

export const reorderUrgencyRank: Record<ReorderUrgency, number> = {
  "Reorder Now": 3,
  "Reorder Soon": 2,
  Low: 1,
};

export const toReorderSuggestionRow = (
  row: VelocitySignalRow,
  rangeDays: number,
): ReorderSuggestionRow => {
  const dailyDemand = rangeDays > 0 ? row.quantitySold / rangeDays : 0;
  const targetCoverageDays = 30;
  const targetStockQty = Math.max(0, Math.ceil(dailyDemand * targetCoverageDays));
  const suggestedReorderQty = Math.max(0, targetStockQty - Math.max(0, row.currentOnHand));
  const daysOfCover = dailyDemand > 0 ? Number((row.currentOnHand / dailyDemand).toFixed(1)) : null;

  let urgency: ReorderUrgency = "Low";
  if (suggestedReorderQty > 0 && (row.currentOnHand <= 0 || (daysOfCover !== null && daysOfCover <= 7))) {
    urgency = "Reorder Now";
  } else if (suggestedReorderQty > 0 || (daysOfCover !== null && daysOfCover <= 14)) {
    urgency = "Reorder Soon";
  }

  return {
    ...row,
    targetStockQty,
    suggestedReorderQty,
    daysOfCover,
    urgency,
  };
};
