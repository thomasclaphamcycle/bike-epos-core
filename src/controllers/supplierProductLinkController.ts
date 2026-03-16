import { Request, Response } from "express";
import {
  createSupplierProductLink,
  listSupplierProductLinks,
  updateSupplierProductLink,
} from "../services/supplierProductLinkService";
import { HttpError } from "../utils/http";

const parseBooleanQuery = (
  value: unknown,
  field: "active" | "preferred",
): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(
      400,
      `${field} must be 1 or 0`,
      "INVALID_SUPPLIER_PRODUCT_LINK_FILTER",
    );
  }

  const normalized = value.trim();
  if (normalized === "1") {
    return true;
  }
  if (normalized === "0") {
    return false;
  }

  throw new HttpError(
    400,
    `${field} must be 1 or 0`,
    "INVALID_SUPPLIER_PRODUCT_LINK_FILTER",
  );
};

const parseOptionalIntQuery = (value: unknown, field: "take" | "skip"): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${field} must be an integer`, "INVALID_SUPPLIER_PRODUCT_LINK_FILTER");
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new HttpError(400, `${field} must be an integer`, "INVALID_SUPPLIER_PRODUCT_LINK_FILTER");
  }
  return parsed;
};

const parseVariantIdsQuery = (value: unknown): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(
      400,
      "variantIds must be a comma-separated string",
      "INVALID_SUPPLIER_PRODUCT_LINK_FILTER",
    );
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const listSupplierProductLinksHandler = async (req: Request, res: Response) => {
  const supplierId = typeof req.query.supplierId === "string" ? req.query.supplierId : undefined;
  const variantId = typeof req.query.variantId === "string" ? req.query.variantId : undefined;
  const q =
    typeof req.query.q === "string"
      ? req.query.q
      : typeof req.query.query === "string"
        ? req.query.query
        : undefined;
  const variantIds = parseVariantIdsQuery(req.query.variantIds);
  const isActive = parseBooleanQuery(req.query.active, "active");
  const preferredSupplier = parseBooleanQuery(req.query.preferred, "preferred");
  const take = parseOptionalIntQuery(req.query.take, "take");
  const skip = parseOptionalIntQuery(req.query.skip, "skip");

  const supplierProductLinks = await listSupplierProductLinks({
    supplierId,
    variantId,
    variantIds,
    q,
    isActive,
    preferredSupplier,
    take,
    skip,
  });

  res.json(supplierProductLinks);
};

export const createSupplierProductLinkHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    supplierId?: unknown;
    variantId?: unknown;
    supplierProductCode?: unknown;
    supplierCostPence?: unknown;
    preferredSupplier?: unknown;
    isActive?: unknown;
  };

  if (body.supplierId !== undefined && typeof body.supplierId !== "string") {
    throw new HttpError(400, "supplierId must be a string", "INVALID_SUPPLIER_PRODUCT_LINK");
  }
  if (body.variantId !== undefined && typeof body.variantId !== "string") {
    throw new HttpError(400, "variantId must be a string", "INVALID_SUPPLIER_PRODUCT_LINK");
  }
  if (
    body.supplierProductCode !== undefined
    && body.supplierProductCode !== null
    && typeof body.supplierProductCode !== "string"
  ) {
    throw new HttpError(
      400,
      "supplierProductCode must be a string or null",
      "INVALID_SUPPLIER_PRODUCT_LINK",
    );
  }
  if (
    body.supplierCostPence !== undefined
    && body.supplierCostPence !== null
    && typeof body.supplierCostPence !== "number"
  ) {
    throw new HttpError(
      400,
      "supplierCostPence must be a number or null",
      "INVALID_SUPPLIER_PRODUCT_LINK",
    );
  }
  if (body.preferredSupplier !== undefined && typeof body.preferredSupplier !== "boolean") {
    throw new HttpError(
      400,
      "preferredSupplier must be a boolean",
      "INVALID_SUPPLIER_PRODUCT_LINK",
    );
  }
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    throw new HttpError(400, "isActive must be a boolean", "INVALID_SUPPLIER_PRODUCT_LINK");
  }

  const link = await createSupplierProductLink({
    supplierId: body.supplierId as string | undefined,
    variantId: body.variantId as string | undefined,
    supplierProductCode: body.supplierProductCode as string | null | undefined,
    supplierCostPence: body.supplierCostPence as number | null | undefined,
    preferredSupplier: body.preferredSupplier as boolean | undefined,
    isActive: body.isActive as boolean | undefined,
  });

  res.status(201).json(link);
};

export const patchSupplierProductLinkHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    supplierProductCode?: unknown;
    supplierCostPence?: unknown;
    preferredSupplier?: unknown;
    isActive?: unknown;
  };

  if (
    body.supplierProductCode !== undefined
    && body.supplierProductCode !== null
    && typeof body.supplierProductCode !== "string"
  ) {
    throw new HttpError(
      400,
      "supplierProductCode must be a string or null",
      "INVALID_SUPPLIER_PRODUCT_LINK_UPDATE",
    );
  }
  if (
    body.supplierCostPence !== undefined
    && body.supplierCostPence !== null
    && typeof body.supplierCostPence !== "number"
  ) {
    throw new HttpError(
      400,
      "supplierCostPence must be a number or null",
      "INVALID_SUPPLIER_PRODUCT_LINK_UPDATE",
    );
  }
  if (body.preferredSupplier !== undefined && typeof body.preferredSupplier !== "boolean") {
    throw new HttpError(
      400,
      "preferredSupplier must be a boolean",
      "INVALID_SUPPLIER_PRODUCT_LINK_UPDATE",
    );
  }
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    throw new HttpError(
      400,
      "isActive must be a boolean",
      "INVALID_SUPPLIER_PRODUCT_LINK_UPDATE",
    );
  }

  const link = await updateSupplierProductLink(req.params.id, {
    supplierProductCode: body.supplierProductCode as string | null | undefined,
    supplierCostPence: body.supplierCostPence as number | null | undefined,
    preferredSupplier: body.preferredSupplier as boolean | undefined,
    isActive: body.isActive as boolean | undefined,
  });

  res.json(link);
};
