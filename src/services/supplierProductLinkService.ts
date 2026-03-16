import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";

type ListSupplierProductLinkFilters = {
  supplierId?: string;
  variantId?: string;
  variantIds?: string[];
  q?: string;
  isActive?: boolean;
  preferredSupplier?: boolean;
  take?: number;
  skip?: number;
};

type CreateSupplierProductLinkInput = {
  supplierId?: string;
  variantId?: string;
  supplierProductCode?: string | null;
  supplierCostPence?: number | null;
  preferredSupplier?: boolean;
  isActive?: boolean;
};

type UpdateSupplierProductLinkInput = {
  supplierProductCode?: string | null;
  supplierCostPence?: number | null;
  preferredSupplier?: boolean;
  isActive?: boolean;
};

type SupplierProductLinkRecord = {
  id: string;
  supplierId: string;
  variantId: string;
  supplierProductCode: string | null;
  supplierCostPence: number | null;
  preferredSupplier: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  supplier: {
    id: string;
    name: string;
  };
  variant: {
    id: string;
    sku: string;
    barcode: string | null;
    name: string | null;
    option: string | null;
    costPricePence: number | null;
    retailPricePence: number;
    product: {
      id: string;
      name: string;
      category: string | null;
      brand: string | null;
    };
  };
};

const LINK_INCLUDE = {
  supplier: {
    select: {
      id: true,
      name: true,
    },
  },
  variant: {
    select: {
      id: true,
      sku: true,
      barcode: true,
      name: true,
      option: true,
      costPricePence: true,
      retailPricePence: true,
      product: {
        select: {
          id: true,
          name: true,
          category: true,
          brand: true,
        },
      },
    },
  },
} satisfies Prisma.SupplierProductLinkInclude;

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

const toNormalizedTake = (take: number | undefined) => {
  if (take === undefined) {
    return undefined;
  }
  if (!Number.isInteger(take) || take < 1 || take > 500) {
    throw new HttpError(
      400,
      "take must be an integer between 1 and 500",
      "INVALID_SUPPLIER_PRODUCT_LINK_FILTER",
    );
  }
  return take;
};

const toNormalizedSkip = (skip: number | undefined) => {
  if (skip === undefined) {
    return undefined;
  }
  if (!Number.isInteger(skip) || skip < 0) {
    throw new HttpError(
      400,
      "skip must be an integer greater than or equal to 0",
      "INVALID_SUPPLIER_PRODUCT_LINK_FILTER",
    );
  }
  return skip;
};

const toNormalizedVariantIds = (variantIds: string[] | undefined) => {
  if (!variantIds) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      variantIds
        .map((value) => normalizeOptionalText(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  if (normalized.length === 0) {
    return undefined;
  }

  if (normalized.length > 200) {
    throw new HttpError(
      400,
      "variantIds can include up to 200 entries",
      "INVALID_SUPPLIER_PRODUCT_LINK_FILTER",
    );
  }

  return normalized;
};

const toSupplierProductLinkResponse = (link: SupplierProductLinkRecord) => ({
  id: link.id,
  supplierId: link.supplierId,
  supplierName: link.supplier.name,
  variantId: link.variantId,
  productId: link.variant.product.id,
  productName: link.variant.product.name,
  productCategory: link.variant.product.category,
  productBrand: link.variant.product.brand,
  sku: link.variant.sku,
  barcode: link.variant.barcode,
  variantName: link.variant.name,
  variantOption: link.variant.option,
  variantCostPricePence: link.variant.costPricePence,
  retailPricePence: link.variant.retailPricePence,
  supplierProductCode: link.supplierProductCode,
  supplierCostPence: link.supplierCostPence,
  preferredSupplier: link.preferredSupplier,
  isActive: link.isActive,
  createdAt: link.createdAt,
  updatedAt: link.updatedAt,
});

const ensureSupplierExists = async (tx: Prisma.TransactionClient, supplierId: string) => {
  const supplier = await tx.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true },
  });

  if (!supplier) {
    throw new HttpError(404, "Supplier not found", "SUPPLIER_NOT_FOUND");
  }
};

const ensureVariantExists = async (tx: Prisma.TransactionClient, variantId: string) => {
  const variant = await tx.variant.findUnique({
    where: { id: variantId },
    select: { id: true },
  });

  if (!variant) {
    throw new HttpError(404, "Variant not found", "VARIANT_NOT_FOUND");
  }
};

const toSupplierCostPence = (
  value: number | null | undefined,
  code: string,
): number | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new HttpError(400, "supplierCostPence must be a non-negative integer or null", code);
  }
  return value;
};

const clearPreferredSupplierForVariant = async (
  tx: Prisma.TransactionClient,
  variantId: string,
  exceptLinkId?: string,
) => {
  await tx.supplierProductLink.updateMany({
    where: {
      variantId,
      preferredSupplier: true,
      ...(exceptLinkId
        ? {
            NOT: {
              id: exceptLinkId,
            },
          }
        : {}),
    },
    data: {
      preferredSupplier: false,
    },
  });
};

export const listSupplierProductLinks = async (filters: ListSupplierProductLinkFilters = {}) => {
  const supplierId = normalizeOptionalText(filters.supplierId);
  if (supplierId && !isUuid(supplierId)) {
    throw new HttpError(
      400,
      "supplierId must be a valid UUID",
      "INVALID_SUPPLIER_PRODUCT_LINK_FILTER",
    );
  }

  const variantId = normalizeOptionalText(filters.variantId);
  const variantIds = toNormalizedVariantIds(filters.variantIds);
  const q = normalizeOptionalText(filters.q);
  const take = toNormalizedTake(filters.take);
  const skip = toNormalizedSkip(filters.skip);

  const supplierProductLinks = await prisma.supplierProductLink.findMany({
    where: {
      ...(supplierId ? { supplierId } : {}),
      ...(variantId ? { variantId } : {}),
      ...(variantIds ? { variantId: { in: variantIds } } : {}),
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...(filters.preferredSupplier !== undefined
        ? { preferredSupplier: filters.preferredSupplier }
        : {}),
      ...(q
        ? {
            OR: [
              { supplier: { name: { contains: q, mode: "insensitive" } } },
              { supplierProductCode: { contains: q, mode: "insensitive" } },
              { variant: { sku: { contains: q, mode: "insensitive" } } },
              { variant: { name: { contains: q, mode: "insensitive" } } },
              { variant: { option: { contains: q, mode: "insensitive" } } },
              { variant: { barcode: { contains: q, mode: "insensitive" } } },
              { variant: { product: { name: { contains: q, mode: "insensitive" } } } },
              { variant: { product: { category: { contains: q, mode: "insensitive" } } } },
              { variant: { product: { brand: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    orderBy: [
      { preferredSupplier: "desc" },
      { isActive: "desc" },
      { updatedAt: "desc" },
      { supplier: { name: "asc" } },
      { variant: { product: { name: "asc" } } },
      { variant: { sku: "asc" } },
    ],
    ...(take !== undefined ? { take } : {}),
    ...(skip !== undefined ? { skip } : {}),
    include: LINK_INCLUDE,
  });

  return {
    supplierProductLinks: supplierProductLinks.map((link) => toSupplierProductLinkResponse(link)),
  };
};

export const createSupplierProductLink = async (input: CreateSupplierProductLinkInput) => {
  const supplierId = normalizeOptionalText(input.supplierId);
  if (!supplierId || !isUuid(supplierId)) {
    throw new HttpError(
      400,
      "supplierId must be a valid UUID",
      "INVALID_SUPPLIER_PRODUCT_LINK",
    );
  }

  const variantId = normalizeOptionalText(input.variantId);
  if (!variantId) {
    throw new HttpError(400, "variantId is required", "INVALID_SUPPLIER_PRODUCT_LINK");
  }

  const supplierCostPence = toSupplierCostPence(
    input.supplierCostPence,
    "INVALID_SUPPLIER_PRODUCT_LINK",
  );
  const preferredSupplier = input.preferredSupplier ?? false;
  const isActive = input.isActive ?? true;

  if (preferredSupplier && !isActive) {
    throw new HttpError(
      400,
      "preferredSupplier requires the link to be active",
      "INVALID_SUPPLIER_PRODUCT_LINK",
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    await ensureSupplierExists(tx, supplierId);
    await ensureVariantExists(tx, variantId);

    const existing = await tx.supplierProductLink.findUnique({
      where: {
        supplierId_variantId: {
          supplierId,
          variantId,
        },
      },
      select: { id: true },
    });

    if (existing) {
      throw new HttpError(
        409,
        "Supplier link for this variant already exists",
        "SUPPLIER_PRODUCT_LINK_EXISTS",
      );
    }

    if (preferredSupplier) {
      await clearPreferredSupplierForVariant(tx, variantId);
    }

    return tx.supplierProductLink.create({
      data: {
        supplierId,
        variantId,
        supplierProductCode: normalizeOptionalNullableText(input.supplierProductCode),
        supplierCostPence: supplierCostPence ?? null,
        preferredSupplier,
        isActive,
      },
      include: LINK_INCLUDE,
    });
  });

  return toSupplierProductLinkResponse(created);
};

export const updateSupplierProductLink = async (
  supplierProductLinkId: string,
  input: UpdateSupplierProductLinkInput,
) => {
  if (!isUuid(supplierProductLinkId)) {
    throw new HttpError(
      400,
      "Invalid supplier product link id",
      "INVALID_SUPPLIER_PRODUCT_LINK_ID",
    );
  }

  const hasSupplierProductCode = Object.prototype.hasOwnProperty.call(input, "supplierProductCode");
  const hasSupplierCostPence = Object.prototype.hasOwnProperty.call(input, "supplierCostPence");
  const hasPreferredSupplier = Object.prototype.hasOwnProperty.call(input, "preferredSupplier");
  const hasIsActive = Object.prototype.hasOwnProperty.call(input, "isActive");

  if (!hasSupplierProductCode && !hasSupplierCostPence && !hasPreferredSupplier && !hasIsActive) {
    throw new HttpError(400, "No fields supplied for update", "INVALID_SUPPLIER_PRODUCT_LINK_UPDATE");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.supplierProductLink.findUnique({
      where: { id: supplierProductLinkId },
      include: LINK_INCLUDE,
    });

    if (!current) {
      throw new HttpError(404, "Supplier product link not found", "SUPPLIER_PRODUCT_LINK_NOT_FOUND");
    }

    const nextIsActive = hasIsActive ? input.isActive ?? current.isActive : current.isActive;
    const requestedPreferredSupplier =
      hasPreferredSupplier ? input.preferredSupplier ?? current.preferredSupplier : current.preferredSupplier;

    if (hasPreferredSupplier && requestedPreferredSupplier && !nextIsActive) {
      throw new HttpError(
        400,
        "preferredSupplier requires the link to be active",
        "INVALID_SUPPLIER_PRODUCT_LINK_UPDATE",
      );
    }

    const nextPreferredSupplier = nextIsActive ? requestedPreferredSupplier : false;

    if (nextPreferredSupplier) {
      await clearPreferredSupplierForVariant(tx, current.variantId, current.id);
    }

    return tx.supplierProductLink.update({
      where: { id: supplierProductLinkId },
      data: {
        ...(hasSupplierProductCode
          ? {
              supplierProductCode: normalizeOptionalNullableText(input.supplierProductCode),
            }
          : {}),
        ...(hasSupplierCostPence
          ? {
              supplierCostPence:
                toSupplierCostPence(input.supplierCostPence, "INVALID_SUPPLIER_PRODUCT_LINK_UPDATE")
                ?? null,
            }
          : {}),
        ...(hasIsActive ? { isActive: nextIsActive } : {}),
        ...(hasPreferredSupplier || !nextIsActive
          ? { preferredSupplier: nextPreferredSupplier }
          : {}),
      },
      include: LINK_INCLUDE,
    });
  });

  return toSupplierProductLinkResponse(updated);
};

export const getActiveSupplierProductLinkForVariant = async (
  tx: Prisma.TransactionClient | typeof prisma,
  supplierId: string,
  variantId: string,
) => {
  return tx.supplierProductLink.findFirst({
    where: {
      supplierId,
      variantId,
      isActive: true,
    },
    select: {
      id: true,
      supplierId: true,
      variantId: true,
      supplierProductCode: true,
      supplierCostPence: true,
      preferredSupplier: true,
      isActive: true,
    },
  });
};
