import { Request, Response } from "express";
import { createSupplier, searchSuppliers } from "../services/purchasingService";
import { HttpError } from "../utils/http";

export const createSupplierHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: string;
    email?: string;
    phone?: string;
    notes?: string;
  };

  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_SUPPLIER");
  }
  if (body.email !== undefined && typeof body.email !== "string") {
    throw new HttpError(400, "email must be a string", "INVALID_SUPPLIER");
  }
  if (body.phone !== undefined && typeof body.phone !== "string") {
    throw new HttpError(400, "phone must be a string", "INVALID_SUPPLIER");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_SUPPLIER");
  }

  const supplier = await createSupplier(body);
  res.status(201).json(supplier);
};

export const listSuppliersHandler = async (req: Request, res: Response) => {
  const query = typeof req.query.query === "string" ? req.query.query : undefined;
  const suppliers = await searchSuppliers(query);
  res.json(suppliers);
};
