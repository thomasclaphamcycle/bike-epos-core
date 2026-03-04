import { Request, Response } from "express";
import {
  createVariant,
  getVariantById,
  listVariants,
  updateVariantById,
} from "../services/productService";
import { HttpError } from "../utils/http";

export const listVariantsHandler = async (req: Request, res: Response) => {
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
  const variants = await listVariants(productId);
  res.json(variants);
};

export const createVariantHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
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

  if (body.productId !== undefined && typeof body.productId !== "string") {
    throw new HttpError(400, "productId must be a string", "INVALID_VARIANT");
  }
  if (body.sku !== undefined && typeof body.sku !== "string") {
    throw new HttpError(400, "sku must be a string", "INVALID_VARIANT");
  }
  if (body.barcode !== undefined && typeof body.barcode !== "string") {
    throw new HttpError(400, "barcode must be a string", "INVALID_VARIANT");
  }
  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_VARIANT");
  }
  if (body.option !== undefined && typeof body.option !== "string") {
    throw new HttpError(400, "option must be a string", "INVALID_VARIANT");
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

export const getVariantHandler = async (req: Request, res: Response) => {
  const variant = await getVariantById(req.params.id);
  res.json(variant);
};

export const patchVariantHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
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

  if (body.productId !== undefined && typeof body.productId !== "string") {
    throw new HttpError(400, "productId must be a string", "INVALID_VARIANT_UPDATE");
  }
  if (body.sku !== undefined && typeof body.sku !== "string") {
    throw new HttpError(400, "sku must be a string", "INVALID_VARIANT_UPDATE");
  }
  if (body.barcode !== undefined && body.barcode !== null && typeof body.barcode !== "string") {
    throw new HttpError(400, "barcode must be a string or null", "INVALID_VARIANT_UPDATE");
  }
  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_VARIANT_UPDATE");
  }
  if (body.option !== undefined && typeof body.option !== "string") {
    throw new HttpError(400, "option must be a string", "INVALID_VARIANT_UPDATE");
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
