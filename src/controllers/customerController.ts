import { Request, Response } from "express";
import {
  createCustomer,
  getCustomerById,
  listCustomerSales,
  searchCustomers,
  updateCustomer,
} from "../services/customerService";
import { HttpError } from "../utils/http";

export const createCustomerHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    email?: unknown;
    phone?: unknown;
    notes?: unknown;
  };

  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_CUSTOMER");
  }
  if (body.firstName !== undefined && typeof body.firstName !== "string") {
    throw new HttpError(400, "firstName must be a string", "INVALID_CUSTOMER");
  }
  if (body.lastName !== undefined && typeof body.lastName !== "string") {
    throw new HttpError(400, "lastName must be a string", "INVALID_CUSTOMER");
  }
  if (body.email !== undefined && typeof body.email !== "string") {
    throw new HttpError(400, "email must be a string", "INVALID_CUSTOMER");
  }
  if (body.phone !== undefined && typeof body.phone !== "string") {
    throw new HttpError(400, "phone must be a string", "INVALID_CUSTOMER");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_CUSTOMER");
  }

  const customer = await createCustomer({
    name: body.name,
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone,
    notes: body.notes,
  });
  res.status(201).json(customer);
};

export const getCustomerHandler = async (req: Request, res: Response) => {
  const customer = await getCustomerById(req.params.id);
  res.json(customer);
};

const parseSearchTake = (value: unknown) => {
  if (value === undefined) {
    return 20;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "take must be an integer", "INVALID_CUSTOMER_SEARCH");
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new HttpError(
      400,
      "take must be an integer between 1 and 100",
      "INVALID_CUSTOMER_SEARCH",
    );
  }
  return parsed;
};

export const searchCustomersHandler = async (req: Request, res: Response) => {
  const query =
    typeof req.query.q === "string"
      ? req.query.q
      : typeof req.query.search === "string"
        ? req.query.search
      : typeof req.query.query === "string"
        ? req.query.query
        : undefined;
  const take = parseSearchTake(req.query.take);
  const result = await searchCustomers(query, take);
  res.json(result);
};

export const listCustomersHandler = async (req: Request, res: Response) => {
  const query =
    typeof req.query.q === "string"
      ? req.query.q
      : typeof req.query.search === "string"
        ? req.query.search
      : typeof req.query.query === "string"
        ? req.query.query
        : undefined;
  const take = parseSearchTake(req.query.take);
  const result = await searchCustomers(query, take);
  res.json(result);
};

export const patchCustomerHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    notes?: unknown;
  };

  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_CUSTOMER_UPDATE");
  }
  if (body.email !== undefined && body.email !== null && typeof body.email !== "string") {
    throw new HttpError(400, "email must be a string or null", "INVALID_CUSTOMER_UPDATE");
  }
  if (body.phone !== undefined && body.phone !== null && typeof body.phone !== "string") {
    throw new HttpError(400, "phone must be a string or null", "INVALID_CUSTOMER_UPDATE");
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string or null", "INVALID_CUSTOMER_UPDATE");
  }

  const customer = await updateCustomer(req.params.id, {
    ...(Object.prototype.hasOwnProperty.call(body, "name") ? { name: body.name as string } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, "email")
      ? { email: body.email as string | null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, "phone")
      ? { phone: body.phone as string | null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, "notes")
      ? { notes: body.notes as string | null }
      : {}),
  });

  res.json(customer);
};

export const listCustomerSalesHandler = async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const result = await listCustomerSales(req.params.id, { from, to });
  res.json(result);
};
