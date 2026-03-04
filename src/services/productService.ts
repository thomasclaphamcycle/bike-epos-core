import { BarcodeType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";

type CreateProductInput = {
  name?: string;
  brand?: string;
  description?: string;
  isActive?: boolean;
};

type UpdateProductInput = {
  name?: string;
  brand?: string;
  description?: string;
  isActive?: boolean;
};

type CreateVariantInput = {
  productId?: string;
  sku?: string;
  barcode?: string;
  name?: string;
  option?: string;
  retailPricePence?: number;
  costPricePence?: number;
  taxCode?: string;
  isActive?: boolean;
};

type UpdateVariantInput = {
  productId?: string;
  sku?: string;
  barcode?: string | null;
  name?: string;
  option?: string;
  retailPricePence?: number;
  costPricePence?: number | null;
  taxCode?: string | null;
  isActive?: boolean;
};

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

const toProductResponse = (product: {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
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
    brand: product.brand,
    description: product.description,
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
  name: string | null;
  option: string | null;
  retailPricePence: number;
  costPricePence: number | null;
  taxCode: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  product?: {
    id: string;
    name: string;
  };
}) => {
  return {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    barcode: variant.barcode,
    name: variant.name,
    option: variant.option,
    retailPricePence: variant.retailPricePence,
    costPricePence: variant.costPricePence,
    taxCode: variant.taxCode,
    isActive: variant.isActive,
    product: variant.product
      ? {
          id: variant.product.id,
          name: variant.product.name,
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

const ensureBarcodeAvailable = async (
  tx: Prisma.TransactionClient | typeof prisma,
  code: string,
  exceptVariantId?: string,
) => {
  const existingVariantBarcode = await tx.variant.findFirst({
    where: {
      barcode: code,
      ...(exceptVariantId
        ? {
            NOT: {
              id: exceptVariantId,
            },
          }
        : {}),
    },
    select: { id: true },
  });

  if (existingVariantBarcode) {
    throw new HttpError(409, "Barcode already exists", "BARCODE_EXISTS");
  }

  const existingBarcode = await tx.barcode.findUnique({
    where: { code },
    select: {
      variantId: true,
    },
  });

  if (existingBarcode && existingBarcode.variantId !== exceptVariantId) {
    throw new HttpError(409, "Barcode already exists", "BARCODE_EXISTS");
  }
};

const upsertPrimaryBarcodeForVariant = async (
  tx: Prisma.TransactionClient,
  variantId: string,
  code: string,
) => {
  const primaryBarcode = await tx.barcode.findFirst({
    where: {
      variantId,
      isPrimary: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (primaryBarcode) {
    if (primaryBarcode.code === code) {
      return;
    }

    await tx.barcode.update({
      where: { id: primaryBarcode.id },
      data: { code },
    });
    return;
  }

  await tx.barcode.create({
    data: {
      variantId,
      code,
      type: BarcodeType.INTERNAL,
      isPrimary: true,
    },
  });
};

const clearPrimaryBarcodeForVariant = async (
  tx: Prisma.TransactionClient,
  variantId: string,
) => {
  await tx.barcode.deleteMany({
    where: {
      variantId,
      isPrimary: true,
    },
  });
};

export const listProducts = async (query?: string) => {
  const normalizedQuery = normalizeOptionalText(query);

  const products = await prisma.product.findMany({
    where: normalizedQuery
      ? {
          OR: [
            { name: { contains: normalizedQuery, mode: "insensitive" } },
            { brand: { contains: normalizedQuery, mode: "insensitive" } },
            { description: { contains: normalizedQuery, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: [{ createdAt: "desc" }],
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

  const product = await prisma.product.create({
    data: {
      name,
      brand: normalizeOptionalText(input.brand),
      description: normalizeOptionalText(input.description),
      isActive: input.isActive ?? true,
    },
  });

  return toProductResponse(product);
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
    Object.prototype.hasOwnProperty.call(input, "brand") ||
    Object.prototype.hasOwnProperty.call(input, "description") ||
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

  if (Object.prototype.hasOwnProperty.call(input, "brand")) {
    data.brand = normalizeOptionalNullableText(input.brand);
  }

  if (Object.prototype.hasOwnProperty.call(input, "description")) {
    data.description = normalizeOptionalNullableText(input.description);
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

export const listVariants = async (productId?: string) => {
  const normalizedProductId = normalizeOptionalText(productId);

  if (normalizedProductId) {
    await ensureProductExists(prisma, normalizedProductId);
  }

  const variants = await prisma.variant.findMany({
    where: normalizedProductId
      ? {
          productId: normalizedProductId,
        }
      : undefined,
    orderBy: [{ createdAt: "desc" }],
    include: {
      product: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return {
    variants: variants.map((variant) => toVariantResponse(variant)),
  };
};

export const createVariant = async (input: CreateVariantInput) => {
  const productId = normalizeOptionalText(input.productId);
  const sku = normalizeOptionalText(input.sku);
  const barcode = normalizeOptionalText(input.barcode);
  const name = normalizeOptionalText(input.name);
  const option = normalizeOptionalText(input.option);
  const taxCode = normalizeOptionalText(input.taxCode);

  if (!productId || !sku) {
    throw new HttpError(400, "productId and sku are required", "INVALID_VARIANT");
  }

  if (
    !Number.isInteger(input.retailPricePence) ||
    (input.retailPricePence ?? -1) < 0
  ) {
    throw new HttpError(
      400,
      "retailPricePence must be a non-negative integer",
      "INVALID_VARIANT",
    );
  }

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

    if (barcode) {
      await ensureBarcodeAvailable(tx, barcode);
    }

    try {
      const variant = await tx.variant.create({
        data: {
          productId,
          sku,
          barcode,
          name,
          option,
          retailPricePence: input.retailPricePence,
          costPricePence: input.costPricePence,
          taxCode,
          isActive: input.isActive ?? true,
        },
      });

      if (barcode) {
        await upsertPrimaryBarcodeForVariant(tx, variant.id, barcode);
      }

      return toVariantResponse(variant);
    } catch (error) {
      const prismaError = error as { code?: string; meta?: { target?: unknown } };
      if (prismaError.code === "P2002") {
        throw new HttpError(409, "Variant SKU or barcode already exists", "VARIANT_EXISTS");
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
    Object.prototype.hasOwnProperty.call(input, "name") ||
    Object.prototype.hasOwnProperty.call(input, "option") ||
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
      data.productId = normalizedProductId;
    }

    if (Object.prototype.hasOwnProperty.call(input, "sku")) {
      const sku = normalizeOptionalText(input.sku);
      if (!sku) {
        throw new HttpError(400, "sku cannot be empty", "INVALID_VARIANT_UPDATE");
      }
      await ensureSkuAvailable(tx, sku, variantId);
      data.sku = sku;
    }

    const hasBarcodeField = Object.prototype.hasOwnProperty.call(input, "barcode");
    let normalizedBarcode: string | null | undefined;
    if (hasBarcodeField) {
      normalizedBarcode = normalizeOptionalNullableText(input.barcode);
      if (normalizedBarcode) {
        await ensureBarcodeAvailable(tx, normalizedBarcode, variantId);
      }
      data.barcode = normalizedBarcode;
    }

    if (Object.prototype.hasOwnProperty.call(input, "name")) {
      data.name = normalizeOptionalNullableText(input.name);
    }

    if (Object.prototype.hasOwnProperty.call(input, "option")) {
      data.option = normalizeOptionalNullableText(input.option);
    }

    if (Object.prototype.hasOwnProperty.call(input, "retailPricePence")) {
      if (
        !Number.isInteger(input.retailPricePence) ||
        (input.retailPricePence ?? -1) < 0
      ) {
        throw new HttpError(
          400,
          "retailPricePence must be a non-negative integer",
          "INVALID_VARIANT_UPDATE",
        );
      }
      data.retailPricePence = input.retailPricePence;
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
      data.costPricePence = input.costPricePence;
    }

    if (Object.prototype.hasOwnProperty.call(input, "taxCode")) {
      data.taxCode = normalizeOptionalNullableText(input.taxCode);
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

      if (hasBarcodeField) {
        if (normalizedBarcode) {
          await upsertPrimaryBarcodeForVariant(tx, variantId, normalizedBarcode);
        } else {
          await clearPrimaryBarcodeForVariant(tx, variantId);
        }
      }

      return toVariantResponse(updated);
    } catch (error) {
      const prismaError = error as { code?: string; meta?: { target?: unknown } };
      if (prismaError.code === "P2002") {
        throw new HttpError(409, "Variant SKU or barcode already exists", "VARIANT_EXISTS");
      }
      throw error;
    }
  });
};

export const ensureVariantExistsById = ensureVariantExists;
