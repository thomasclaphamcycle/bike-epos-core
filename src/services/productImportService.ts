import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createImportedProductRow } from "./productService";
import { parseCsv } from "../utils/csv";
import { HttpError } from "../utils/http";

type ProductImportField =
  | "name"
  | "sku"
  | "barcode"
  | "retailPrice"
  | "cost"
  | "stockQuantity"
  | "category";

type PreviewParsedRow = {
  name: string | null;
  sku: string | null;
  barcode: string | null;
  retailPrice: string | null;
  retailPricePence: number | null;
  cost: string | null;
  costPricePence: number | null;
  stockQuantity: number;
  category: string | null;
};

type PreviewItem = {
  rowNumber: number;
  source: Record<ProductImportField, string>;
  parsed: PreviewParsedRow;
  errors: string[];
  warnings: string[];
  isEligible: boolean;
};

const REQUIRED_FIELDS: ProductImportField[] = ["name", "sku", "retailPrice"];

const FIELD_LABELS: Record<ProductImportField, string> = {
  name: "Name",
  sku: "SKU",
  barcode: "Barcode",
  retailPrice: "Retail price",
  cost: "Cost",
  stockQuantity: "Stock quantity",
  category: "Category",
};

const FIELD_ALIASES: Record<ProductImportField, string[]> = {
  name: ["name", "productname", "product"],
  sku: ["sku", "productsku", "variantsku"],
  barcode: ["barcode", "ean", "upc"],
  retailPrice: ["retailprice", "retail", "price", "sellprice", "sellingprice"],
  cost: ["cost", "costprice", "buyprice"],
  stockQuantity: ["stockquantity", "stockqty", "quantity", "qty", "onhand", "openingstock"],
  category: ["category", "productcategory"],
};

const normalizeHeader = (value: string) =>
  value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const normalizeCell = (value: string | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : "";
};

const normalizeCsvText = (value: string) =>
  value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const toPreviewKey = (value: string) =>
  createHash("sha256").update(normalizeCsvText(value), "utf8").digest("hex");

const toMoneyCell = (
  raw: string,
  field: ProductImportField,
  required: boolean,
  errors: string[],
) => {
  const value = normalizeCell(raw);
  if (!value) {
    if (required) {
      errors.push(`${FIELD_LABELS[field]} is required`);
    }
    return {
      normalized: null,
      pence: null,
    };
  }

  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(value);
  } catch {
    errors.push(`${FIELD_LABELS[field]} must be a valid amount`);
    return {
      normalized: null,
      pence: null,
    };
  }

  if (decimal.isNegative()) {
    errors.push(`${FIELD_LABELS[field]} must be 0 or greater`);
    return {
      normalized: null,
      pence: null,
    };
  }

  if (decimal.decimalPlaces() > 2) {
    errors.push(`${FIELD_LABELS[field]} must use up to 2 decimal places`);
    return {
      normalized: null,
      pence: null,
    };
  }

  return {
    normalized: decimal.toFixed(2),
    pence: decimal.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber(),
  };
};

const toStockQuantity = (raw: string, errors: string[]) => {
  const value = normalizeCell(raw);
  if (!value) {
    return 0;
  }

  if (!/^-?\d+$/.test(value)) {
    errors.push("Stock quantity must be a whole number");
    return 0;
  }

  const quantity = Number.parseInt(value, 10);
  if (quantity < 0) {
    errors.push("Stock quantity must be 0 or greater");
    return 0;
  }

  return quantity;
};

const buildHeaderIndex = (headers: string[]) => {
  const normalizedHeaders = headers.map(normalizeHeader);
  const fieldIndex = {} as Record<ProductImportField, number | undefined>;
  const usedIndexes = new Set<number>();

  (Object.keys(FIELD_ALIASES) as ProductImportField[]).forEach((field) => {
    const alias = FIELD_ALIASES[field].find((candidate) => normalizedHeaders.includes(candidate));
    if (!alias) {
      fieldIndex[field] = undefined;
      return;
    }

    const headerIndex = normalizedHeaders.findIndex((header) => header === alias);
    fieldIndex[field] = headerIndex;
    usedIndexes.add(headerIndex);
  });

  return {
    fieldIndex,
    unknownHeaders: headers.filter((header, index) => normalizeHeader(header) && !usedIndexes.has(index)),
  };
};

const toRowSource = (
  row: string[],
  fieldIndex: Record<ProductImportField, number | undefined>,
): Record<ProductImportField, string> => ({
  name: fieldIndex.name === undefined ? "" : normalizeCell(row[fieldIndex.name]),
  sku: fieldIndex.sku === undefined ? "" : normalizeCell(row[fieldIndex.sku]),
  barcode: fieldIndex.barcode === undefined ? "" : normalizeCell(row[fieldIndex.barcode]),
  retailPrice: fieldIndex.retailPrice === undefined ? "" : normalizeCell(row[fieldIndex.retailPrice]),
  cost: fieldIndex.cost === undefined ? "" : normalizeCell(row[fieldIndex.cost]),
  stockQuantity: fieldIndex.stockQuantity === undefined ? "" : normalizeCell(row[fieldIndex.stockQuantity]),
  category: fieldIndex.category === undefined ? "" : normalizeCell(row[fieldIndex.category]),
});

const buildPreview = async (csvText: string) => {
  const normalizedCsv = normalizeCsvText(csvText);
  if (!normalizedCsv.trim()) {
    throw new HttpError(400, "csvText is required", "INVALID_PRODUCT_IMPORT");
  }

  let parsedRows: string[][];
  try {
    parsedRows = parseCsv(normalizedCsv);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "CSV could not be parsed",
      "INVALID_PRODUCT_IMPORT",
    );
  }

  if (parsedRows.length === 0) {
    throw new HttpError(400, "CSV is empty", "INVALID_PRODUCT_IMPORT");
  }

  const [headerRow, ...bodyRows] = parsedRows;
  if (!headerRow.some((cell) => normalizeCell(cell))) {
    throw new HttpError(400, "CSV header row is empty", "INVALID_PRODUCT_IMPORT");
  }

  const dataRows = bodyRows.filter((row) => row.some((cell) => normalizeCell(cell)));
  if (dataRows.length === 0) {
    throw new HttpError(400, "CSV has no data rows", "INVALID_PRODUCT_IMPORT");
  }

  const { fieldIndex, unknownHeaders } = buildHeaderIndex(headerRow);
  const fileErrors = REQUIRED_FIELDS
    .filter((field) => fieldIndex[field] === undefined)
    .map((field) => `Missing required column: ${FIELD_LABELS[field]}`);
  const fileWarnings = [
    ...(unknownHeaders.length > 0
      ? [`Unknown columns ignored: ${unknownHeaders.join(", ")}`]
      : []),
    ...(bodyRows.length !== dataRows.length
      ? ["Blank rows were ignored during preview"]
      : []),
  ];

  const baseItems = dataRows.map((row, rowIndex) => {
    const source = toRowSource(row, fieldIndex);
    const errors: string[] = [];
    const warnings: string[] = [];

    const name = source.name || null;
    const sku = source.sku || null;
    const barcode = source.barcode || null;
    const category = source.category || null;

    if (!name) {
      errors.push("Name is required");
    }
    if (!sku) {
      errors.push("SKU is required");
    } else if (sku.length < 2) {
      errors.push("SKU must be at least 2 characters");
    }

    const retailPrice = toMoneyCell(source.retailPrice, "retailPrice", true, errors);
    const cost = toMoneyCell(source.cost, "cost", false, errors);
    const stockQuantity = toStockQuantity(source.stockQuantity, errors);

    if (!barcode) {
      warnings.push("Barcode is missing");
    }
    if (!category) {
      warnings.push("Category is missing");
    }
    if (cost.pence === null) {
      warnings.push("Cost is missing");
    }
    if (cost.pence !== null && retailPrice.pence !== null && cost.pence > retailPrice.pence) {
      warnings.push("Cost exceeds retail price");
    }
    if (stockQuantity > 0 && cost.pence === null) {
      warnings.push("Opening stock has no cost price");
    }

    return {
      rowNumber: rowIndex + 2,
      source,
      parsed: {
        name,
        sku,
        barcode,
        retailPrice: retailPrice.normalized,
        retailPricePence: retailPrice.pence,
        cost: cost.normalized,
        costPricePence: cost.pence,
        stockQuantity,
        category,
      },
      errors,
      warnings,
    };
  });

  const skuCounts = new Map<string, number>();
  const barcodeCounts = new Map<string, number>();
  for (const item of baseItems) {
    if (item.parsed.sku) {
      skuCounts.set(item.parsed.sku, (skuCounts.get(item.parsed.sku) ?? 0) + 1);
    }
    if (item.parsed.barcode) {
      barcodeCounts.set(item.parsed.barcode, (barcodeCounts.get(item.parsed.barcode) ?? 0) + 1);
    }
  }

  const skus = Array.from(new Set(baseItems.map((item) => item.parsed.sku).filter(Boolean))) as string[];
  const barcodes = Array.from(new Set(baseItems.map((item) => item.parsed.barcode).filter(Boolean))) as string[];

  const [existingSkus, existingVariantBarcodes, existingBarcodeRows] = await Promise.all([
    skus.length > 0
      ? prisma.variant.findMany({
          where: {
            sku: {
              in: skus,
            },
          },
          select: { sku: true },
        })
      : Promise.resolve([]),
    barcodes.length > 0
      ? prisma.variant.findMany({
          where: {
            barcode: {
              in: barcodes,
            },
          },
          select: { barcode: true },
        })
      : Promise.resolve([]),
    barcodes.length > 0
      ? prisma.barcode.findMany({
          where: {
            code: {
              in: barcodes,
            },
          },
          select: { code: true },
        })
      : Promise.resolve([]),
  ]);

  const existingSkuSet = new Set(existingSkus.map((row) => row.sku));
  const existingBarcodeSet = new Set([
    ...existingVariantBarcodes.map((row) => row.barcode).filter(Boolean),
    ...existingBarcodeRows.map((row) => row.code),
  ]);

  const items: PreviewItem[] = baseItems.map((item) => {
    const errors = [...item.errors];

    if (item.parsed.sku && (skuCounts.get(item.parsed.sku) ?? 0) > 1) {
      errors.push("SKU is duplicated within the CSV");
    }
    if (item.parsed.sku && existingSkuSet.has(item.parsed.sku)) {
      errors.push("SKU already exists in the catalogue");
    }
    if (item.parsed.barcode && (barcodeCounts.get(item.parsed.barcode) ?? 0) > 1) {
      errors.push("Barcode is duplicated within the CSV");
    }
    if (item.parsed.barcode && existingBarcodeSet.has(item.parsed.barcode)) {
      errors.push("Barcode already exists in the catalogue");
    }

    return {
      ...item,
      errors,
      isEligible: errors.length === 0,
    };
  });

  return {
    previewKey: toPreviewKey(normalizedCsv),
    fileErrors,
    fileWarnings,
    summary: {
      totalRows: items.length,
      eligibleRows: items.filter((item) => item.isEligible).length,
      errorRows: items.filter((item) => item.errors.length > 0).length,
      warningRows: items.filter((item) => item.warnings.length > 0).length,
      fileErrorCount: fileErrors.length,
      fileWarningCount: fileWarnings.length,
    },
    items,
  };
};

export const previewProductCsvImport = async (input: { csvText?: string }) => {
  const csvText = typeof input.csvText === "string" ? input.csvText : "";
  return buildPreview(csvText);
};

export const confirmProductCsvImport = async (input: {
  csvText?: string;
  previewKey?: string;
  createdByStaffId?: string;
}) => {
  const csvText = typeof input.csvText === "string" ? input.csvText : "";
  const previewKey = typeof input.previewKey === "string" ? input.previewKey.trim() : "";

  if (!previewKey) {
    throw new HttpError(400, "previewKey is required", "INVALID_PRODUCT_IMPORT_CONFIRM");
  }

  const preview = await buildPreview(csvText);
  if (preview.previewKey !== previewKey) {
    throw new HttpError(409, "Preview is stale. Run preview again before importing.", "STALE_PRODUCT_IMPORT_PREVIEW");
  }

  const eligibleItems = preview.items.filter((item) => item.isEligible);
  if (eligibleItems.length === 0) {
    throw new HttpError(
      400,
      "No eligible rows are available to import",
      "INVALID_PRODUCT_IMPORT_CONFIRM",
    );
  }

  const importedRows: Array<{
    rowNumber: number;
    productId: string;
    variantId: string;
    name: string;
    sku: string;
    stockImported: number;
  }> = [];
  const failedRows: Array<{
    rowNumber: number;
    sku: string | null;
    error: string;
  }> = [];

  const importBatchId = preview.previewKey.slice(0, 12);
  for (const item of eligibleItems) {
    try {
      const imported = await createImportedProductRow({
        name: item.parsed.name ?? "",
        category: item.parsed.category,
        sku: item.parsed.sku ?? "",
        barcode: item.parsed.barcode,
        retailPrice: item.parsed.retailPrice ?? "0.00",
        costPricePence: item.parsed.costPricePence,
        openingStockQty: item.parsed.stockQuantity,
        createdByStaffId: input.createdByStaffId,
        importReferenceId: `csv_${importBatchId}_row_${item.rowNumber}`,
      });

      importedRows.push({
        rowNumber: item.rowNumber,
        productId: imported.product.id,
        variantId: imported.variant.id,
        name: imported.product.name,
        sku: imported.variant.sku,
        stockImported: imported.stockImported,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        failedRows.push({
          rowNumber: item.rowNumber,
          sku: item.parsed.sku,
          error: error.message,
        });
        continue;
      }

      throw error;
    }
  }

  return {
    previewKey: preview.previewKey,
    summary: {
      totalRows: preview.summary.totalRows,
      eligibleRows: preview.summary.eligibleRows,
      importedRows: importedRows.length,
      failedRows: failedRows.length,
      skippedRows: preview.summary.totalRows - importedRows.length,
      warningRows: preview.summary.warningRows,
    },
    importedRows,
    failedRows,
  };
};
