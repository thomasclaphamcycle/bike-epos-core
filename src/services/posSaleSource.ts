import { PosSaleSource } from "@prisma/client";

export const POS_SALE_SOURCE_VALUES = Object.values(PosSaleSource);

export const isPosSaleSource = (value: unknown): value is PosSaleSource =>
  typeof value === "string" && POS_SALE_SOURCE_VALUES.includes(value as PosSaleSource);

export const normalizePosSaleSource = (value: unknown): PosSaleSource => {
  if (value === undefined || value === null || value === "") {
    return PosSaleSource.RETAIL;
  }

  if (!isPosSaleSource(value)) {
    throw new Error("Invalid POS sale source");
  }

  return value;
};

const POS_SALE_SOURCE_LABELS: Record<PosSaleSource, string> = {
  [PosSaleSource.RETAIL]: "Retail Sale",
  [PosSaleSource.QUOTE]: "Quote",
  [PosSaleSource.WEB]: "Web Sale",
  [PosSaleSource.WORKSHOP]: "Workshop Sale",
  [PosSaleSource.EXCHANGE]: "Exchange",
};

export const getPosSaleSourceLabel = (source: PosSaleSource) =>
  POS_SALE_SOURCE_LABELS[source] ?? POS_SALE_SOURCE_LABELS.RETAIL;

export const getPosSaleSourceDetail = (source: PosSaleSource, sourceRef: string | null) => {
  if (!sourceRef) {
    return null;
  }

  if (source === PosSaleSource.WORKSHOP) {
    return `Job #${sourceRef}`;
  }

  if (source === PosSaleSource.QUOTE) {
    return `Quote ${sourceRef}`;
  }

  if (source === PosSaleSource.WEB) {
    return `Order ${sourceRef}`;
  }

  if (source === PosSaleSource.EXCHANGE) {
    return `Original sale ${sourceRef}`;
  }

  return null;
};

export const buildPosSaleSourceSummary = (source: PosSaleSource, sourceRef: string | null) => ({
  source,
  sourceRef,
  sourceLabel: getPosSaleSourceLabel(source),
  sourceDetail: getPosSaleSourceDetail(source, sourceRef),
});
