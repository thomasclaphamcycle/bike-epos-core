import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { resolveInventoryStockLocationIdTx } from "./locationService";
import {
  ensureBarcodeCodeAvailableTx,
  generateNextInternalBarcodeTx,
  getPreferredVariantBarcode,
  syncVariantBarcodeRegistryTx,
} from "./barcodeService";

type CreateProductInput = {
  name?: string;
  category?: string;
  brand?: string;
  description?: string;
  keySellingPoints?: string;
  isActive?: boolean;
  defaultVariant?: {
    sku?: string;
    barcode?: string;
    manufacturerBarcode?: string;
    retailPrice?: string | number;
    retailPricePence?: number;
    isActive?: boolean;
  };
};

type UpdateProductInput = {
  name?: string;
  category?: string;
  brand?: string;
  description?: string;
  keySellingPoints?: string | null;
  isActive?: boolean;
};

type CreateVariantInput = {
  productId?: string;
  sku?: string;
  barcode?: string;
  manufacturerBarcode?: string;
  name?: string;
  option?: string;
  retailPrice?: string | number;
  retailPricePence?: number;
  costPricePence?: number;
  taxCode?: string;
  isActive?: boolean;
};

type CreateImportedProductRowInput = {
  name: string;
  category?: string | null;
  sku: string;
  barcode?: string | null;
  manufacturerBarcode?: string | null;
  retailPrice: string | number;
  costPricePence?: number | null;
  openingStockQty?: number;
  createdByStaffId?: string;
  importReferenceId?: string;
};

type UpdateVariantInput = {
  productId?: string;
  sku?: string;
  barcode?: string | null;
  manufacturerBarcode?: string | null;
  name?: string;
  option?: string;
  retailPrice?: string | number;
  retailPricePence?: number;
  costPricePence?: number | null;
  taxCode?: string | null;
  isActive?: boolean;
};

type ListProductsInput = {
  q?: string;
  isActive?: boolean;
  take?: number;
  skip?: number;
};

type ListVariantsInput = {
  q?: string;
  isActive?: boolean;
  take?: number;
  skip?: number;
  productId?: string;
};

type SearchProductsInput = {
  q?: string;
  barcode?: string;
  sku?: string;
  locationId?: string;
  take?: number;
  skip?: number;
};

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getOrCreateDefaultStockLocationTx = async (tx: Prisma.TransactionClient) => {
  const existingDefault = await tx.stockLocation.findFirst({
    where: { isDefault: true },
    orderBy: { createdAt: "asc" },
  });

  if (existingDefault) {
    return existingDefault;
  }

  return tx.stockLocation.create({
    data: {
      name: "Default",
      isDefault: true,
    },
  });
};

const normalizeOptionalNullableText = (value: string | undefined | null): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizePreferredManufacturerBarcodeInput = (
  manufacturerBarcode: string | undefined | null,
  barcode: string | undefined | null,
) => normalizeOptionalNullableText(manufacturerBarcode) ?? normalizeOptionalNullableText(barcode);

const toNormalizedTake = (take: number | undefined): number | undefined => {
  if (take === undefined) {
    return undefined;
  }
  if (!Number.isInteger(take) || take < 1 || take > 200) {
    throw new HttpError(400, "take must be an integer between 1 and 200", "INVALID_PAGINATION");
  }
  return take;
};

const toNormalizedSkip = (skip: number | undefined): number | undefined => {
  if (skip === undefined) {
    return undefined;
  }
  if (!Number.isInteger(skip) || skip < 0) {
    throw new HttpError(400, "skip must be an integer greater than or equal to 0", "INVALID_PAGINATION");
  }
  return skip;
};

const decimalToPence = (value: Prisma.Decimal): number =>
  value.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();

const parseRetailPriceInput = (
  retailPrice: string | number | undefined,
  retailPricePence: number | undefined,
  code: string,
) => {
  const hasRetailPrice = retailPrice !== undefined;
  const hasRetailPricePence = retailPricePence !== undefined;

  if (!hasRetailPrice && !hasRetailPricePence) {
    throw new HttpError(400, "retailPrice is required", code);
  }

  if (hasRetailPricePence) {
    if (!Number.isInteger(retailPricePence) || (retailPricePence ?? -1) < 0) {
      throw new HttpError(
        400,
        "retailPricePence must be a non-negative integer",
        code,
      );
    }
  }

  let decimal: Prisma.Decimal | undefined;
  if (hasRetailPrice) {
    try {
      decimal = new Prisma.Decimal(retailPrice as string | number);
    } catch {
      throw new HttpError(400, "retailPrice must be a valid decimal value", code);
    }
    if (decimal.isNegative()) {
      throw new HttpError(400, "retailPrice must be non-negative", code);
    }
    if (decimal.decimalPlaces() > 2) {
      throw new HttpError(400, "retailPrice must have up to 2 decimal places", code);
    }
  }

  if (decimal && hasRetailPricePence) {
    const derived = decimalToPence(decimal);
    if (derived !== retailPricePence) {
      throw new HttpError(
        400,
        "retailPrice and retailPricePence do not match",
        code,
      );
    }
  }

  if (decimal) {
    return {
      retailPrice: decimal.toDecimalPlaces(2),
      retailPricePence: decimalToPence(decimal),
    };
  }

  return {
    retailPrice: new Prisma.Decimal((retailPricePence as number) / 100).toDecimalPlaces(2),
    retailPricePence: retailPricePence as number,
  };
};

const parseRetailPricePatch = (
  input: UpdateVariantInput,
  code: string,
): { retailPrice?: Prisma.Decimal; retailPricePence?: number } => {
  const hasRetailPrice = Object.prototype.hasOwnProperty.call(input, "retailPrice");
  const hasRetailPricePence = Object.prototype.hasOwnProperty.call(input, "retailPricePence");

  if (!hasRetailPrice && !hasRetailPricePence) {
    return {};
  }

  const parsed = parseRetailPriceInput(
    hasRetailPrice ? input.retailPrice : undefined,
    hasRetailPricePence ? input.retailPricePence : undefined,
    code,
  );

  return parsed;
};

const toProductResponse = (product: {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  description: string | null;
  keySellingPoints: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count?: {
    variants: number;
  };
}) => {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    brand: product.brand,
    description: product.description,
    keySellingPoints: product.keySellingPoints,
    isActive: product.isActive,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    variantCount: product._count?.variants,
  };
};

const toVariantResponse = (variant: {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  manufacturerBarcode: string | null;
  internalBarcode: string | null;
  name: string | null;
  option: string | null;
  retailPrice: Prisma.Decimal;
  retailPricePence: number;
  costPricePence: number | null;
  taxCode: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
    product?: {
      id: string;
      name: string;
      category: string | null;
      brand: string | null;
      keySellingPoints?: string | null;
    };
}) => {
  return {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    barcode: variant.barcode,
    manufacturerBarcode: variant.manufacturerBarcode,
    internalBarcode: variant.internalBarcode,
    name: variant.name,
    option: variant.option,
    retailPrice: variant.retailPrice.toFixed(2),
    retailPricePence: variant.retailPricePence,
    costPricePence: variant.costPricePence,
    taxCode: variant.taxCode,
    isActive: variant.isActive,
    product: variant.product
      ? {
          id: variant.product.id,
          name: variant.product.name,
          category: variant.product.category,
          brand: variant.product.brand,
          keySellingPoints: variant.product.keySellingPoints ?? null,
        }
      : undefined,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
};

const ensureProductExists = async (
  tx: Prisma.TransactionClient | typeof prisma,
  productId: string,
) => {
  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) {
    throw new HttpError(404, "Product not found", "PRODUCT_NOT_FOUND");
  }
  return product;
};

const ensureVariantExists = async (
  tx: Prisma.TransactionClient | typeof prisma,
  variantId: string,
) => {
  const variant = await tx.variant.findUnique({ where: { id: variantId } });
  if (!variant) {
    throw new HttpError(404, "Variant not found", "VARIANT_NOT_FOUND");
  }
  return variant;
};

const ensureSkuAvailable = async (
  tx: Prisma.TransactionClient | typeof prisma,
  sku: string,
  exceptVariantId?: string,
) => {
  const existing = await tx.variant.findUnique({ where: { sku } });
  if (existing && existing.id !== exceptVariantId) {
    throw new HttpError(409, "SKU already exists", "SKU_EXISTS");
  }
};

const resolveVariantBarcodeStateTx = async (
  tx: Prisma.TransactionClient,
  input: {
    manufacturerBarcode: string | null;
    existingInternalBarcode?: string | null;
    existingManufacturerBarcode?: string | null;
    variantId?: string;
  },
) => {
  if (
    input.manufacturerBarcode
    && input.manufacturerBarcode !== (input.existingManufacturerBarcode ?? null)
  ) {
    await ensureBarcodeCodeAvailableTx(tx, input.manufacturerBarcode, input.variantId);
  }

  let internalBarcode = input.existingInternalBarcode ?? null;
  if (!input.manufacturerBarcode && !internalBarcode) {
    internalBarcode = await generateNextInternalBarcodeTx(tx, input.variantId);
  }

  return {
    manufacturerBarcode: input.manufacturerBarcode,
    internalBarcode,
    barcode: getPreferredVariantBarcode({
      manufacturerBarcode: input.manufacturerBarcode,
      internalBarcode,
    }),
  };
};

const toVariantConflictError = (
  prismaError: { meta?: { target?: unknown } },
): HttpError => {
  const target = Array.isArray(prismaError.meta?.target)
    ? prismaError.meta?.target.map(String)
    : [];

  if (target.includes("sku")) {
    return new HttpError(409, "SKU already exists", "SKU_EXISTS");
  }

  if (
    target.includes("barcode")
    || target.includes("manufacturerBarcode")
    || target.includes("internalBarcode")
  ) {
    return new HttpError(409, "Barcode already exists", "BARCODE_EXISTS");
  }

  return new HttpError(409, "Variant SKU or barcode already exists", "VARIANT_EXISTS");
};

export const listProducts = async (filters: ListProductsInput = {}) => {
  const normalizedQuery = normalizeOptionalText(filters.q);
  const take = toNormalizedTake(filters.take);
  const skip = toNormalizedSkip(filters.skip);

  const products = await prisma.product.findMany({
    where: {
      ...(normalizedQuery
        ? {
            OR: [
              { name: { contains: normalizedQuery, mode: "insensitive" } },
              { category: { contains: normalizedQuery, mode: "insensitive" } },
              { brand: { contains: normalizedQuery, mode: "insensitive" } },
              { description: { contains: normalizedQuery, mode: "insensitive" } },
              { keySellingPoints: { contains: normalizedQuery, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    ...(take !== undefined ? { take } : {}),
    ...(skip !== undefined ? { skip } : {}),
    include: {
      _count: {
        select: {
          variants: true,
        },
      },
    },
  });

  return {
    products: products.map((product) => toProductResponse(product)),
  };
};

export const createProduct = async (input: CreateProductInput) => {
  const name = normalizeOptionalText(input.name);
  if (!name) {
    throw new HttpError(400, "name is required", "INVALID_PRODUCT");
  }

  if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
    throw new HttpError(400, "isActive must be a boolean", "INVALID_PRODUCT");
  }

  const category = normalizeOptionalText(input.category);
  const hasDefaultVariant =
    input.defaultVariant !== undefined
    && Object.values(input.defaultVariant).some((value) => value !== undefined);

  return prisma.$transaction(async (tx) => {
    const brand = normalizeOptionalText(input.brand);
    const description = normalizeOptionalText(input.description);
    const keySellingPoints = normalizeOptionalText(input.keySellingPoints);
    const product = await tx.product.create({
      data: {
        name,
        ...(category !== undefined ? { category } : {}),
        ...(brand !== undefined ? { brand } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(keySellingPoints !== undefined ? { keySellingPoints } : {}),
        isActive: input.isActive ?? true,
      },
    });

    if (hasDefaultVariant) {
      const sku = normalizeOptionalText(input.defaultVariant?.sku);
      const manufacturerBarcode = normalizePreferredManufacturerBarcodeInput(
        input.defaultVariant?.manufacturerBarcode,
        input.defaultVariant?.barcode,
      ) ?? null;

      if (!sku) {
        throw new HttpError(400, "defaultVariant.sku is required", "INVALID_PRODUCT");
      }
      if (sku.length < 2) {
        throw new HttpError(400, "defaultVariant.sku must be at least 2 characters", "INVALID_PRODUCT");
      }

      const parsedRetailPrice = parseRetailPriceInput(
        input.defaultVariant?.retailPrice,
        input.defaultVariant?.retailPricePence,
        "INVALID_PRODUCT",
      );

      await ensureSkuAvailable(tx, sku);
      const barcodeState = await resolveVariantBarcodeStateTx(tx, {
        manufacturerBarcode,
      });

      const variant = await tx.variant.create({
        data: {
          productId: product.id,
          sku,
          barcode: barcodeState.barcode,
          manufacturerBarcode: barcodeState.manufacturerBarcode,
          internalBarcode: barcodeState.internalBarcode,
          retailPrice: parsedRetailPrice.retailPrice,
          retailPricePence: parsedRetailPrice.retailPricePence,
          isActive: input.defaultVariant?.isActive ?? input.isActive ?? true,
        },
      });

      await syncVariantBarcodeRegistryTx(tx, variant.id, {
        manufacturerBarcode: barcodeState.manufacturerBarcode,
        internalBarcode: barcodeState.internalBarcode,
        preferredBarcode: barcodeState.barcode,
      });
    }

    return toProductResponse(product);
  });
};

export const createImportedProductRow = async (input: CreateImportedProductRowInput) => {
  const name = normalizeOptionalText(input.name);
  const category = normalizeOptionalNullableText(input.category);
  const sku = normalizeOptionalText(input.sku);
  const manufacturerBarcode = normalizePreferredManufacturerBarcodeInput(
    input.manufacturerBarcode,
    input.barcode,
  ) ?? null;
  const createdByStaffId = normalizeOptionalNullableText(input.createdByStaffId);
  const importReferenceId = normalizeOptionalText(input.importReferenceId) ?? sku ?? "PRODUCT_IMPORT";
  const openingStockQty = input.openingStockQty ?? 0;

  if (!name) {
    throw new HttpError(400, "name is required", "INVALID_PRODUCT_IMPORT");
  }
  if (!sku) {
    throw new HttpError(400, "sku is required", "INVALID_PRODUCT_IMPORT");
  }
  if (sku.length < 2) {
    throw new HttpError(400, "sku must be at least 2 characters", "INVALID_PRODUCT_IMPORT");
  }
  if (!Number.isInteger(openingStockQty) || openingStockQty < 0) {
    throw new HttpError(
      400,
      "openingStockQty must be an integer greater than or equal to 0",
      "INVALID_PRODUCT_IMPORT",
    );
  }
  if (
    input.costPricePence !== undefined &&
    input.costPricePence !== null &&
    (!Number.isInteger(input.costPricePence) || input.costPricePence < 0)
  ) {
    throw new HttpError(
      400,
      "costPricePence must be null or a non-negative integer",
      "INVALID_PRODUCT_IMPORT",
    );
  }

  const parsedRetailPrice = parseRetailPriceInput(
    input.retailPrice,
    undefined,
    "INVALID_PRODUCT_IMPORT",
  );

  return prisma.$transaction(async (tx) => {
    await ensureSkuAvailable(tx, sku);
    const barcodeState = await resolveVariantBarcodeStateTx(tx, {
      manufacturerBarcode,
    });

    const product = await tx.product.create({
      data: {
        name,
        ...(category !== undefined ? { category } : {}),
        isActive: true,
      },
    });

    const variant = await tx.variant.create({
      data: {
        productId: product.id,
        sku,
        barcode: barcodeState.barcode,
        manufacturerBarcode: barcodeState.manufacturerBarcode,
        internalBarcode: barcodeState.internalBarcode,
        retailPrice: parsedRetailPrice.retailPrice,
        retailPricePence: parsedRetailPrice.retailPricePence,
        costPricePence: input.costPricePence ?? null,
        isActive: true,
      },
    });

    await syncVariantBarcodeRegistryTx(tx, variant.id, {
      manufacturerBarcode: barcodeState.manufacturerBarcode,
      internalBarcode: barcodeState.internalBarcode,
      preferredBarcode: barcodeState.barcode,
    });

    if (openingStockQty > 0) {
      const defaultStockLocation = await getOrCreateDefaultStockLocationTx(tx);

      await tx.stockLedgerEntry.create({
        data: {
          variantId: variant.id,
          locationId: defaultStockLocation.id,
          type: "ADJUSTMENT",
          quantityDelta: openingStockQty,
          referenceType: "PRODUCT_IMPORT",
          referenceId: importReferenceId,
          note: "Product CSV import opening stock",
        },
      });

      await tx.inventoryMovement.create({
        data: {
          variantId: variant.id,
          locationId: defaultStockLocation.id,
          type: "ADJUSTMENT",
          quantity: openingStockQty,
          referenceType: "PRODUCT_IMPORT",
          referenceId: importReferenceId,
          note: "Product CSV import opening stock",
          ...(createdByStaffId !== undefined ? { createdByStaffId } : {}),
        },
      });
    }

    return {
      product: toProductResponse(product),
      variant: toVariantResponse(variant),
      stockImported: openingStockQty,
    };
  });
};

export const getProductById = async (productId: string) => {
  if (!productId) {
    throw new HttpError(400, "Invalid product id", "INVALID_PRODUCT_ID");
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      _count: {
        select: { variants: true },
      },
    },
  });

  if (!product) {
    throw new HttpError(404, "Product not found", "PRODUCT_NOT_FOUND");
  }

  return toProductResponse(product);
};

export const updateProductById = async (productId: string, input: UpdateProductInput) => {
  if (!productId) {
    throw new HttpError(400, "Invalid product id", "INVALID_PRODUCT_ID");
  }

  const hasAnyField =
    Object.prototype.hasOwnProperty.call(input, "name") ||
    Object.prototype.hasOwnProperty.call(input, "category") ||
    Object.prototype.hasOwnProperty.call(input, "brand") ||
    Object.prototype.hasOwnProperty.call(input, "description") ||
    Object.prototype.hasOwnProperty.call(input, "keySellingPoints") ||
    Object.prototype.hasOwnProperty.call(input, "isActive");

  if (!hasAnyField) {
    throw new HttpError(400, "No fields provided", "INVALID_PRODUCT_UPDATE");
  }

  const data: Prisma.ProductUpdateInput = {};

  if (Object.prototype.hasOwnProperty.call(input, "name")) {
    const name = normalizeOptionalText(input.name);
    if (!name) {
      throw new HttpError(400, "name cannot be empty", "INVALID_PRODUCT_UPDATE");
    }
    data.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(input, "category")) {
    data.category = normalizeOptionalNullableText(input.category) ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(input, "brand")) {
    data.brand = normalizeOptionalNullableText(input.brand) ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(input, "description")) {
    data.description = normalizeOptionalNullableText(input.description) ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(input, "keySellingPoints")) {
    data.keySellingPoints = normalizeOptionalNullableText(input.keySellingPoints) ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(input, "isActive")) {
    if (typeof input.isActive !== "boolean") {
      throw new HttpError(400, "isActive must be a boolean", "INVALID_PRODUCT_UPDATE");
    }
    data.isActive = input.isActive;
  }

  try {
    const product = await prisma.product.update({
      where: { id: productId },
      data,
    });

    return toProductResponse(product);
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2025") {
      throw new HttpError(404, "Product not found", "PRODUCT_NOT_FOUND");
    }
    throw error;
  }
};

export const listVariants = async (filters: ListVariantsInput = {}) => {
  const normalizedProductId = normalizeOptionalText(filters.productId);
  const normalizedQuery = normalizeOptionalText(filters.q);
  const take = toNormalizedTake(filters.take);
  const skip = toNormalizedSkip(filters.skip);

  if (normalizedProductId) {
    await ensureProductExists(prisma, normalizedProductId);
  }

  const variants = await prisma.variant.findMany({
    where: {
      ...(normalizedProductId ? { productId: normalizedProductId } : {}),
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...(normalizedQuery
        ? {
            OR: [
              { sku: { contains: normalizedQuery, mode: "insensitive" } },
              { barcode: { contains: normalizedQuery, mode: "insensitive" } },
              { manufacturerBarcode: { contains: normalizedQuery, mode: "insensitive" } },
              { internalBarcode: { contains: normalizedQuery, mode: "insensitive" } },
              { name: { contains: normalizedQuery, mode: "insensitive" } },
              { option: { contains: normalizedQuery, mode: "insensitive" } },
              {
                barcodes: {
                  some: {
                    code: { contains: normalizedQuery, mode: "insensitive" },
                  },
                },
              },
              {
                product: {
                  category: { contains: normalizedQuery, mode: "insensitive" },
                },
              },
              {
                product: {
                  name: { contains: normalizedQuery, mode: "insensitive" },
                },
              },
              {
                product: {
                  brand: { contains: normalizedQuery, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    ...(take !== undefined ? { take } : {}),
    ...(skip !== undefined ? { skip } : {}),
    include: {
      product: {
        select: {
          id: true,
          name: true,
          category: true,
          brand: true,
          keySellingPoints: true,
        },
      },
    },
  });

  return {
    variants: variants.map((variant) => toVariantResponse(variant)),
  };
};

export const searchProducts = async (filters: SearchProductsInput = {}) => {
  const normalizedQ = normalizeOptionalText(filters.q);
  const normalizedBarcode = normalizeOptionalText(filters.barcode);
  const normalizedSku = normalizeOptionalText(filters.sku);
  const take = toNormalizedTake(filters.take) ?? 20;
  const skip = toNormalizedSkip(filters.skip) ?? 0;

  const hasFilter = Boolean(normalizedQ || normalizedBarcode || normalizedSku);
  if (!hasFilter) {
    return {
      rows: [],
    };
  }

  const variants = await prisma.variant.findMany({
    where: {
      isActive: true,
      ...(normalizedSku
        ? {
            sku: {
              contains: normalizedSku,
              mode: "insensitive",
            },
          }
        : {}),
      ...(normalizedBarcode
        ? {
            OR: [
              {
                barcode: {
                  equals: normalizedBarcode,
                  mode: "insensitive",
                },
              },
              {
                manufacturerBarcode: {
                  equals: normalizedBarcode,
                  mode: "insensitive",
                },
              },
              {
                internalBarcode: {
                  equals: normalizedBarcode,
                  mode: "insensitive",
                },
              },
              {
                barcode: {
                  contains: normalizedBarcode,
                  mode: "insensitive",
                },
              },
              {
                manufacturerBarcode: {
                  contains: normalizedBarcode,
                  mode: "insensitive",
                },
              },
              {
                internalBarcode: {
                  contains: normalizedBarcode,
                  mode: "insensitive",
                },
              },
              {
                barcodes: {
                  some: {
                    code: {
                      equals: normalizedBarcode,
                      mode: "insensitive",
                    },
                  },
                },
              },
            ],
          }
        : {}),
      ...(normalizedQ
        ? {
            OR: [
              {
                sku: {
                  contains: normalizedQ,
                  mode: "insensitive",
                },
              },
              {
                barcode: {
                  contains: normalizedQ,
                  mode: "insensitive",
                },
              },
              {
                manufacturerBarcode: {
                  contains: normalizedQ,
                  mode: "insensitive",
                },
              },
              {
                internalBarcode: {
                  contains: normalizedQ,
                  mode: "insensitive",
                },
              },
              {
                name: {
                  contains: normalizedQ,
                  mode: "insensitive",
                },
              },
              {
                option: {
                  contains: normalizedQ,
                  mode: "insensitive",
                },
              },
              {
                product: {
                  category: {
                    contains: normalizedQ,
                    mode: "insensitive",
                  },
                },
              },
              {
                product: {
                  name: {
                    contains: normalizedQ,
                    mode: "insensitive",
                  },
                },
              },
              {
                product: {
                  brand: {
                    contains: normalizedQ,
                    mode: "insensitive",
                  },
                },
              },
              {
                barcodes: {
                  some: {
                    code: {
                      contains: normalizedQ,
                      mode: "insensitive",
                    },
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      product: {
        select: {
          name: true,
          category: true,
        },
      },
      barcodes: {
        select: {
          code: true,
          isPrimary: true,
        },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take,
    skip,
  });

  const variantIds = variants.map((variant) => variant.id);
  const requestedLocationId = normalizeOptionalText(filters.locationId);
  const groupedOnHand =
    variantIds.length > 0
      ? await prisma.$transaction(async (tx) => {
          const stockLocationId = await resolveInventoryStockLocationIdTx(tx, requestedLocationId);

          return tx.inventoryMovement.groupBy({
            by: ["variantId"],
            where: {
              locationId: stockLocationId,
              variantId: {
                in: variantIds,
              },
            },
            _sum: {
              quantity: true,
            },
          });
        })
      : [];

  const onHandByVariantId = new Map(
    groupedOnHand.map((row) => [row.variantId, row._sum.quantity ?? 0]),
  );

  return {
    rows: variants.map((variant) => ({
      id: variant.id,
      productId: variant.productId,
      name: variant.name ?? variant.option ?? variant.product.name,
      sku: variant.sku,
      barcode: variant.barcode ?? variant.barcodes[0]?.code ?? null,
      pricePence: variant.retailPricePence,
      onHandQty: onHandByVariantId.get(variant.id) ?? 0,
    })),
  };
};

export const getProductByBarcode = async (barcode: string, locationId?: string) => {
  const normalizedBarcode = normalizeOptionalText(barcode);
  if (!normalizedBarcode) {
    throw new HttpError(400, "barcode is required", "INVALID_BARCODE");
  }

  const requestedLocationId = normalizeOptionalText(locationId);

  return prisma.$transaction(async (tx) => {
    const variant = await tx.variant.findFirst({
      where: {
        isActive: true,
        OR: [
          {
            barcode: {
              equals: normalizedBarcode,
              mode: "insensitive",
            },
          },
          {
            manufacturerBarcode: {
              equals: normalizedBarcode,
              mode: "insensitive",
            },
          },
          {
            internalBarcode: {
              equals: normalizedBarcode,
              mode: "insensitive",
            },
          },
          {
            barcodes: {
              some: {
                code: {
                  equals: normalizedBarcode,
                  mode: "insensitive",
                },
              },
            },
          },
        ],
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
          },
        },
        barcodes: {
          select: {
            code: true,
            isPrimary: true,
          },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });

    if (!variant) {
      throw new HttpError(404, "Barcode not found", "BARCODE_NOT_FOUND");
    }

    const stockLocationId = await resolveInventoryStockLocationIdTx(tx, requestedLocationId);

    const aggregate = await tx.inventoryMovement.aggregate({
      where: {
        variantId: variant.id,
        locationId: stockLocationId,
      },
      _sum: {
        quantity: true,
      },
    });

    return {
      row: {
        id: variant.id,
        productId: variant.productId,
        name: variant.name ?? variant.option ?? variant.product.name,
        sku: variant.sku,
        barcode: variant.barcode ?? variant.barcodes[0]?.code ?? null,
        pricePence: variant.retailPricePence,
        onHandQty: aggregate._sum.quantity ?? 0,
      },
    };
  });
};

export const createVariant = async (input: CreateVariantInput) => {
  const productId = normalizeOptionalText(input.productId);
  const sku = normalizeOptionalText(input.sku);
  const manufacturerBarcode = normalizePreferredManufacturerBarcodeInput(
    input.manufacturerBarcode,
    input.barcode,
  ) ?? null;
  const name = normalizeOptionalText(input.name);
  const option = normalizeOptionalText(input.option);
  const taxCode = normalizeOptionalText(input.taxCode);

  if (!productId || !sku) {
    throw new HttpError(400, "productId and sku are required", "INVALID_VARIANT");
  }
  if (sku.length < 2) {
    throw new HttpError(400, "sku must be at least 2 characters", "INVALID_VARIANT");
  }

  const parsedRetailPrice = parseRetailPriceInput(
    input.retailPrice,
    input.retailPricePence,
    "INVALID_VARIANT",
  );

  if (
    input.costPricePence !== undefined &&
    (!Number.isInteger(input.costPricePence) || (input.costPricePence ?? -1) < 0)
  ) {
    throw new HttpError(
      400,
      "costPricePence must be a non-negative integer",
      "INVALID_VARIANT",
    );
  }

  if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
    throw new HttpError(400, "isActive must be a boolean", "INVALID_VARIANT");
  }

  return prisma.$transaction(async (tx) => {
    await ensureProductExists(tx, productId);
    await ensureSkuAvailable(tx, sku);
    const barcodeState = await resolveVariantBarcodeStateTx(tx, {
      manufacturerBarcode,
    });

    try {
      const variantCreateData: Prisma.VariantUncheckedCreateInput = {
        productId,
        sku,
        barcode: barcodeState.barcode,
        manufacturerBarcode: barcodeState.manufacturerBarcode,
        internalBarcode: barcodeState.internalBarcode,
        retailPrice: parsedRetailPrice.retailPrice,
        retailPricePence: parsedRetailPrice.retailPricePence,
        ...(name !== undefined ? { name } : {}),
        ...(option !== undefined ? { option } : {}),
        ...(input.costPricePence !== undefined ? { costPricePence: input.costPricePence } : {}),
        ...(taxCode !== undefined ? { taxCode } : {}),
        isActive: input.isActive ?? true,
      };

      const variant = await tx.variant.create({
        data: variantCreateData,
      });

      await syncVariantBarcodeRegistryTx(tx, variant.id, {
        manufacturerBarcode: barcodeState.manufacturerBarcode,
        internalBarcode: barcodeState.internalBarcode,
        preferredBarcode: barcodeState.barcode,
      });

      return toVariantResponse(variant);
    } catch (error) {
      const prismaError = error as { code?: string; meta?: { target?: unknown } };
      if (prismaError.code === "P2002") {
        throw toVariantConflictError(prismaError);
      }
      throw error;
    }
  });
};

export const getVariantById = async (variantId: string) => {
  if (!variantId) {
    throw new HttpError(400, "Invalid variant id", "INVALID_VARIANT_ID");
  }

  const variant = await prisma.variant.findUnique({
    where: { id: variantId },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          category: true,
          brand: true,
        },
      },
    },
  });

  if (!variant) {
    throw new HttpError(404, "Variant not found", "VARIANT_NOT_FOUND");
  }

  return toVariantResponse(variant);
};

export const updateVariantById = async (variantId: string, input: UpdateVariantInput) => {
  if (!variantId) {
    throw new HttpError(400, "Invalid variant id", "INVALID_VARIANT_ID");
  }

  const hasAnyField =
    Object.prototype.hasOwnProperty.call(input, "productId") ||
    Object.prototype.hasOwnProperty.call(input, "sku") ||
    Object.prototype.hasOwnProperty.call(input, "barcode") ||
    Object.prototype.hasOwnProperty.call(input, "manufacturerBarcode") ||
    Object.prototype.hasOwnProperty.call(input, "name") ||
    Object.prototype.hasOwnProperty.call(input, "option") ||
    Object.prototype.hasOwnProperty.call(input, "retailPrice") ||
    Object.prototype.hasOwnProperty.call(input, "retailPricePence") ||
    Object.prototype.hasOwnProperty.call(input, "costPricePence") ||
    Object.prototype.hasOwnProperty.call(input, "taxCode") ||
    Object.prototype.hasOwnProperty.call(input, "isActive");

  if (!hasAnyField) {
    throw new HttpError(400, "No fields provided", "INVALID_VARIANT_UPDATE");
  }

  return prisma.$transaction(async (tx) => {
    const variant = await tx.variant.findUnique({
      where: { id: variantId },
    });

    if (!variant) {
      throw new HttpError(404, "Variant not found", "VARIANT_NOT_FOUND");
    }

    const data: Prisma.VariantUpdateInput = {};
    const normalizedProductId = normalizeOptionalText(input.productId);

    if (Object.prototype.hasOwnProperty.call(input, "productId")) {
      if (!normalizedProductId) {
        throw new HttpError(400, "productId cannot be empty", "INVALID_VARIANT_UPDATE");
      }
      await ensureProductExists(tx, normalizedProductId);
      data.product = {
        connect: {
          id: normalizedProductId,
        },
      };
    }

    if (Object.prototype.hasOwnProperty.call(input, "sku")) {
      const sku = normalizeOptionalText(input.sku);
      if (!sku) {
        throw new HttpError(400, "sku cannot be empty", "INVALID_VARIANT_UPDATE");
      }
      if (sku.length < 2) {
        throw new HttpError(400, "sku must be at least 2 characters", "INVALID_VARIANT_UPDATE");
      }
      await ensureSkuAvailable(tx, sku, variantId);
      data.sku = sku;
    }

    const hasBarcodeField = Object.prototype.hasOwnProperty.call(input, "barcode");
    const hasManufacturerBarcodeField = Object.prototype.hasOwnProperty.call(input, "manufacturerBarcode");
    let nextBarcodeState:
      | {
          barcode: string | null;
          manufacturerBarcode: string | null;
          internalBarcode: string | null;
        }
      | null = null;
    if (hasBarcodeField || hasManufacturerBarcodeField) {
      const normalizedManufacturerBarcode =
        normalizePreferredManufacturerBarcodeInput(
          hasManufacturerBarcodeField ? input.manufacturerBarcode : undefined,
          hasBarcodeField ? input.barcode : undefined,
        ) ?? null;
      nextBarcodeState = await resolveVariantBarcodeStateTx(tx, {
        manufacturerBarcode: normalizedManufacturerBarcode,
        existingManufacturerBarcode: variant.manufacturerBarcode,
        existingInternalBarcode: variant.internalBarcode,
        variantId,
      });
      data.barcode = nextBarcodeState.barcode;
      data.manufacturerBarcode = nextBarcodeState.manufacturerBarcode;
      data.internalBarcode = nextBarcodeState.internalBarcode;
    }

    if (Object.prototype.hasOwnProperty.call(input, "name")) {
      data.name = normalizeOptionalNullableText(input.name) ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "option")) {
      data.option = normalizeOptionalNullableText(input.option) ?? null;
    }

    const retailPricePatch = parseRetailPricePatch(input, "INVALID_VARIANT_UPDATE");
    if (retailPricePatch.retailPrice !== undefined) {
      data.retailPrice = retailPricePatch.retailPrice;
    }
    if (retailPricePatch.retailPricePence !== undefined) {
      data.retailPricePence = retailPricePatch.retailPricePence;
    }

    if (Object.prototype.hasOwnProperty.call(input, "costPricePence")) {
      if (
        input.costPricePence !== null &&
        (!Number.isInteger(input.costPricePence) || (input.costPricePence ?? -1) < 0)
      ) {
        throw new HttpError(
          400,
          "costPricePence must be null or a non-negative integer",
          "INVALID_VARIANT_UPDATE",
        );
      }
      data.costPricePence = input.costPricePence ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "taxCode")) {
      data.taxCode = normalizeOptionalNullableText(input.taxCode) ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "isActive")) {
      if (typeof input.isActive !== "boolean") {
        throw new HttpError(400, "isActive must be a boolean", "INVALID_VARIANT_UPDATE");
      }
      data.isActive = input.isActive;
    }

    try {
      const updated = await tx.variant.update({
        where: { id: variantId },
        data,
      });

      if (nextBarcodeState) {
        await syncVariantBarcodeRegistryTx(tx, variantId, {
          manufacturerBarcode: nextBarcodeState.manufacturerBarcode,
          internalBarcode: nextBarcodeState.internalBarcode,
          preferredBarcode: nextBarcodeState.barcode,
        });
      }

      return toVariantResponse(updated);
    } catch (error) {
      const prismaError = error as { code?: string; meta?: { target?: unknown } };
      if (prismaError.code === "P2002") {
        throw toVariantConflictError(prismaError);
      }
      throw error;
    }
  });
};

export const ensureVariantExistsById = ensureVariantExists;
