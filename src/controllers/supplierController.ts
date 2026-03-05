import { Request, Response } from "express";
import {
  createSupplier,
  getSupplierById,
  listSupplierPurchaseOrders,
  searchSuppliers,
  updateSupplier,
} from "../services/purchasingService";
import { HttpError } from "../utils/http";

export const createSupplierHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: string;
    email?: string;
    phone?: string;
    leadTimeDays?: number;
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
  if (body.leadTimeDays !== undefined && typeof body.leadTimeDays !== "number") {
    throw new HttpError(400, "leadTimeDays must be a number", "INVALID_SUPPLIER");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_SUPPLIER");
  }

  const supplier = await createSupplier(body);
  res.status(201).json(supplier);
};

export const listSuppliersHandler = async (req: Request, res: Response) => {
  const search =
    typeof req.query.search === "string"
      ? req.query.search
      : typeof req.query.query === "string"
        ? req.query.query
        : undefined;
  const suppliers = await searchSuppliers(search);
  res.json(suppliers);
};

export const getSupplierHandler = async (req: Request, res: Response) => {
  const supplier = await getSupplierById(req.params.id);
  res.json(supplier);
};

export const patchSupplierHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: string;
    email?: string | null;
    phone?: string | null;
    leadTimeDays?: number | null;
    notes?: string | null;
  };

  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_SUPPLIER_UPDATE");
  }
  if (body.email !== undefined && body.email !== null && typeof body.email !== "string") {
    throw new HttpError(400, "email must be a string or null", "INVALID_SUPPLIER_UPDATE");
  }
  if (body.phone !== undefined && body.phone !== null && typeof body.phone !== "string") {
    throw new HttpError(400, "phone must be a string or null", "INVALID_SUPPLIER_UPDATE");
  }
  if (body.leadTimeDays !== undefined && body.leadTimeDays !== null && typeof body.leadTimeDays !== "number") {
    throw new HttpError(400, "leadTimeDays must be a number or null", "INVALID_SUPPLIER_UPDATE");
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string or null", "INVALID_SUPPLIER_UPDATE");
  }

  const supplier = await updateSupplier(req.params.id, body);
  res.json(supplier);
};

export const listSupplierPurchaseOrdersHandler = async (req: Request, res: Response) => {
  const result = await listSupplierPurchaseOrders(req.params.id);
  res.json(result);
};
