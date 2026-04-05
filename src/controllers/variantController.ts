import { Request, Response } from "express";
import {
  createVariant,
  getVariantById,
  listVariants,
  updateVariantById,
} from "../services/productService";
import { printProductLabelDirect } from "../services/productLabelPrintService";
import { HttpError } from "../utils/http";
import { parseOptionalIntegerQuery } from "../utils/requestParsing";

const parseActiveQuery = (value: unknown): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "active must be 1 or 0", "INVALID_VARIANT_FILTER");
  }
  const normalized = value.trim();
  if (normalized === "1") {
    return true;
  }
  if (normalized === "0") {
    return false;
  }
  throw new HttpError(400, "active must be 1 or 0", "INVALID_VARIANT_FILTER");
};

export const listVariantsHandler = async (req: Request, res: Response) => {
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
  const q =
    typeof req.query.q === "string"
      ? req.query.q
      : typeof req.query.query === "string"
        ? req.query.query
        : undefined;
  const isActive = parseActiveQuery(req.query.active);
  const take = parseOptionalIntegerQuery(req.query.take, {
    code: "INVALID_VARIANT_FILTER",
    message: "take must be an integer",
  });
  const skip = parseOptionalIntegerQuery(req.query.skip, {
    code: "INVALID_VARIANT_FILTER",
    message: "skip must be an integer",
  });

  const variants = await listVariants({ q, isActive, take, skip, productId });
  res.json(variants);
};

export const createVariantHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
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

  if (body.productId !== undefined && typeof body.productId !== "string") {
    throw new HttpError(400, "productId must be a string", "INVALID_VARIANT");
  }
  if (body.sku !== undefined && typeof body.sku !== "string") {
    throw new HttpError(400, "sku must be a string", "INVALID_VARIANT");
  }
  if (body.barcode !== undefined && typeof body.barcode !== "string") {
    throw new HttpError(400, "barcode must be a string", "INVALID_VARIANT");
  }
  if (body.manufacturerBarcode !== undefined && typeof body.manufacturerBarcode !== "string") {
    throw new HttpError(400, "manufacturerBarcode must be a string", "INVALID_VARIANT");
  }
  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_VARIANT");
  }
  if (body.option !== undefined && typeof body.option !== "string") {
    throw new HttpError(400, "option must be a string", "INVALID_VARIANT");
  }
  if (
    body.retailPrice !== undefined &&
    typeof body.retailPrice !== "number" &&
    typeof body.retailPrice !== "string"
  ) {
    throw new HttpError(400, "retailPrice must be a number or string", "INVALID_VARIANT");
  }
  if (body.taxCode !== undefined && typeof body.taxCode !== "string") {
    throw new HttpError(400, "taxCode must be a string", "INVALID_VARIANT");
  }
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    throw new HttpError(400, "isActive must be a boolean", "INVALID_VARIANT");
  }

  const variant = await createVariant(body);
  res.status(201).json(variant);
};

export const createVariantForProductHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
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

  if (body.sku !== undefined && typeof body.sku !== "string") {
    throw new HttpError(400, "sku must be a string", "INVALID_VARIANT");
  }
  if (body.barcode !== undefined && typeof body.barcode !== "string") {
    throw new HttpError(400, "barcode must be a string", "INVALID_VARIANT");
  }
  if (body.manufacturerBarcode !== undefined && typeof body.manufacturerBarcode !== "string") {
    throw new HttpError(400, "manufacturerBarcode must be a string", "INVALID_VARIANT");
  }
  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_VARIANT");
  }
  if (body.option !== undefined && typeof body.option !== "string") {
    throw new HttpError(400, "option must be a string", "INVALID_VARIANT");
  }
  if (
    body.retailPrice !== undefined &&
    typeof body.retailPrice !== "number" &&
    typeof body.retailPrice !== "string"
  ) {
    throw new HttpError(400, "retailPrice must be a number or string", "INVALID_VARIANT");
  }
  if (body.taxCode !== undefined && typeof body.taxCode !== "string") {
    throw new HttpError(400, "taxCode must be a string", "INVALID_VARIANT");
  }
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    throw new HttpError(400, "isActive must be a boolean", "INVALID_VARIANT");
  }

  const variant = await createVariant({
    ...body,
    productId: req.params.productId,
  });
  res.status(201).json(variant);
};

export const getVariantHandler = async (req: Request, res: Response) => {
  const variant = await getVariantById(req.params.id);
  res.json(variant);
};

export const printVariantProductLabelDirectHandler = async (req: Request, res: Response) => {
  const body = req.body ?? {};
  if (body && (typeof body !== "object" || Array.isArray(body))) {
    throw new HttpError(400, "product label print body must be an object", "INVALID_PRODUCT_LABEL_PRINT");
  }

  const record = body as {
    printerId?: unknown;
    printerKey?: unknown;
    copies?: unknown;
  };

  if (record.printerId !== undefined && record.printerId !== null && typeof record.printerId !== "string") {
    throw new HttpError(400, "printerId must be a string or null", "INVALID_PRODUCT_LABEL_PRINT");
  }
  if (record.printerKey !== undefined && record.printerKey !== null && typeof record.printerKey !== "string") {
    throw new HttpError(400, "printerKey must be a string or null", "INVALID_PRODUCT_LABEL_PRINT");
  }
  if (record.copies !== undefined && !Number.isInteger(record.copies)) {
    throw new HttpError(400, "copies must be an integer", "INVALID_PRODUCT_LABEL_PRINT");
  }

  const response = await printProductLabelDirect(req.params.id, {
    printerId: (record.printerId as string | null | undefined) ?? undefined,
    printerKey: (record.printerKey as string | null | undefined) ?? undefined,
    copies: record.copies as number | undefined,
  });

  res.status(201).json(response);
};

export const patchVariantHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
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

  if (body.productId !== undefined && typeof body.productId !== "string") {
    throw new HttpError(400, "productId must be a string", "INVALID_VARIANT_UPDATE");
  }
  if (body.sku !== undefined && typeof body.sku !== "string") {
    throw new HttpError(400, "sku must be a string", "INVALID_VARIANT_UPDATE");
  }
  if (body.barcode !== undefined && body.barcode !== null && typeof body.barcode !== "string") {
    throw new HttpError(400, "barcode must be a string or null", "INVALID_VARIANT_UPDATE");
  }
  if (
    body.manufacturerBarcode !== undefined
    && body.manufacturerBarcode !== null
    && typeof body.manufacturerBarcode !== "string"
  ) {
    throw new HttpError(400, "manufacturerBarcode must be a string or null", "INVALID_VARIANT_UPDATE");
  }
  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_VARIANT_UPDATE");
  }
  if (body.option !== undefined && typeof body.option !== "string") {
    throw new HttpError(400, "option must be a string", "INVALID_VARIANT_UPDATE");
  }
  if (
    body.retailPrice !== undefined &&
    typeof body.retailPrice !== "number" &&
    typeof body.retailPrice !== "string"
  ) {
    throw new HttpError(
      400,
      "retailPrice must be a number or string",
      "INVALID_VARIANT_UPDATE",
    );
  }
  if (body.taxCode !== undefined && body.taxCode !== null && typeof body.taxCode !== "string") {
    throw new HttpError(400, "taxCode must be a string or null", "INVALID_VARIANT_UPDATE");
  }
  if (body.costPricePence !== undefined && body.costPricePence !== null && typeof body.costPricePence !== "number") {
    throw new HttpError(400, "costPricePence must be a number or null", "INVALID_VARIANT_UPDATE");
  }
  if (body.retailPricePence !== undefined && typeof body.retailPricePence !== "number") {
    throw new HttpError(400, "retailPricePence must be a number", "INVALID_VARIANT_UPDATE");
  }
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    throw new HttpError(400, "isActive must be a boolean", "INVALID_VARIANT_UPDATE");
  }

  const variant = await updateVariantById(req.params.id, body);
  res.json(variant);
};
