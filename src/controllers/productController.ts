import { Request, Response } from "express";
import {
  createProduct,
  getProductById,
  listProducts,
  searchProducts,
  updateProductById,
} from "../services/productService";
import { HttpError } from "../utils/http";

const parseActiveQuery = (value: unknown): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "active must be 1 or 0", "INVALID_PRODUCT_FILTER");
  }
  const normalized = value.trim();
  if (normalized === "1") {
    return true;
  }
  if (normalized === "0") {
    return false;
  }
  throw new HttpError(400, "active must be 1 or 0", "INVALID_PRODUCT_FILTER");
};

const parseOptionalIntQuery = (
  value: unknown,
  field: "take" | "skip",
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${field} must be an integer`, "INVALID_PRODUCT_FILTER");
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new HttpError(400, `${field} must be an integer`, "INVALID_PRODUCT_FILTER");
  }
  return parsed;
};

export const listProductsHandler = async (req: Request, res: Response) => {
  const q =
    typeof req.query.q === "string"
      ? req.query.q
      : typeof req.query.query === "string"
        ? req.query.query
        : undefined;
  const isActive = parseActiveQuery(req.query.active);
  const take = parseOptionalIntQuery(req.query.take, "take");
  const skip = parseOptionalIntQuery(req.query.skip, "skip");

  const products = await listProducts({ q, isActive, take, skip });
  res.json(products);
};

export const searchProductsHandler = async (req: Request, res: Response) => {
  const q =
    typeof req.query.q === "string"
      ? req.query.q
      : typeof req.query.query === "string"
        ? req.query.query
        : undefined;
  const barcode = typeof req.query.barcode === "string" ? req.query.barcode : undefined;
  const sku = typeof req.query.sku === "string" ? req.query.sku : undefined;
  const take = parseOptionalIntQuery(req.query.take, "take");
  const skip = parseOptionalIntQuery(req.query.skip, "skip");

  const results = await searchProducts({ q, barcode, sku, take, skip });
  res.json(results);
};

export const createProductHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: string;
    category?: string;
    brand?: string;
    description?: string;
    isActive?: boolean;
    defaultVariant?: {
      sku?: string;
      barcode?: string;
      retailPrice?: string | number;
      retailPricePence?: number;
      isActive?: boolean;
    };
  };

  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_PRODUCT");
  }
  if (body.category !== undefined && typeof body.category !== "string") {
    throw new HttpError(400, "category must be a string", "INVALID_PRODUCT");
  }
  if (body.brand !== undefined && typeof body.brand !== "string") {
    throw new HttpError(400, "brand must be a string", "INVALID_PRODUCT");
  }
  if (body.description !== undefined && typeof body.description !== "string") {
    throw new HttpError(400, "description must be a string", "INVALID_PRODUCT");
  }
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    throw new HttpError(400, "isActive must be a boolean", "INVALID_PRODUCT");
  }
  if (body.defaultVariant !== undefined && (typeof body.defaultVariant !== "object" || body.defaultVariant === null)) {
    throw new HttpError(400, "defaultVariant must be an object", "INVALID_PRODUCT");
  }
  if (body.defaultVariant?.sku !== undefined && typeof body.defaultVariant.sku !== "string") {
    throw new HttpError(400, "defaultVariant.sku must be a string", "INVALID_PRODUCT");
  }
  if (body.defaultVariant?.barcode !== undefined && typeof body.defaultVariant.barcode !== "string") {
    throw new HttpError(400, "defaultVariant.barcode must be a string", "INVALID_PRODUCT");
  }
  if (
    body.defaultVariant?.retailPrice !== undefined &&
    typeof body.defaultVariant.retailPrice !== "number" &&
    typeof body.defaultVariant.retailPrice !== "string"
  ) {
    throw new HttpError(400, "defaultVariant.retailPrice must be a number or string", "INVALID_PRODUCT");
  }
  if (
    body.defaultVariant?.retailPricePence !== undefined &&
    typeof body.defaultVariant.retailPricePence !== "number"
  ) {
    throw new HttpError(400, "defaultVariant.retailPricePence must be a number", "INVALID_PRODUCT");
  }
  if (body.defaultVariant?.isActive !== undefined && typeof body.defaultVariant.isActive !== "boolean") {
    throw new HttpError(400, "defaultVariant.isActive must be a boolean", "INVALID_PRODUCT");
  }

  const product = await createProduct(body);
  res.status(201).json(product);
};

export const getProductHandler = async (req: Request, res: Response) => {
  const product = await getProductById(req.params.id);
  res.json(product);
};

export const patchProductHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: string;
    category?: string;
    brand?: string;
    description?: string;
    isActive?: boolean;
  };

  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_PRODUCT_UPDATE");
  }
  if (body.category !== undefined && typeof body.category !== "string") {
    throw new HttpError(400, "category must be a string", "INVALID_PRODUCT_UPDATE");
  }
  if (body.brand !== undefined && typeof body.brand !== "string") {
    throw new HttpError(400, "brand must be a string", "INVALID_PRODUCT_UPDATE");
  }
  if (body.description !== undefined && typeof body.description !== "string") {
    throw new HttpError(400, "description must be a string", "INVALID_PRODUCT_UPDATE");
  }
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    throw new HttpError(400, "isActive must be a boolean", "INVALID_PRODUCT_UPDATE");
  }

  const product = await updateProductById(req.params.id, body);
  res.json(product);
};
