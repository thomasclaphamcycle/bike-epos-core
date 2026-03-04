import { Request, Response } from "express";
import {
  createProduct,
  getProductById,
  listProducts,
  updateProductById,
} from "../services/productService";
import { HttpError } from "../utils/http";

export const listProductsHandler = async (req: Request, res: Response) => {
  const query = typeof req.query.query === "string" ? req.query.query : undefined;
  const products = await listProducts(query);
  res.json(products);
};

export const createProductHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: string;
    brand?: string;
    description?: string;
    isActive?: boolean;
  };

  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_PRODUCT");
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
    brand?: string;
    description?: string;
    isActive?: boolean;
  };

  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_PRODUCT_UPDATE");
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
