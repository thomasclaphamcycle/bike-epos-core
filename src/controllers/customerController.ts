import { Request, Response } from "express";
import {
  createCustomer,
  getCustomerById,
  getCustomerTimeline,
  listCustomerSales,
  listCustomerWorkshopJobs,
  searchCustomers,
} from "../services/customerService";
import {
  createCustomerBike,
  getCustomerBikeHistory,
  listCustomerBikes,
} from "../services/customerBikeService";
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

const parseOptionalFilterTake = (value: unknown): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "take must be an integer", "INVALID_CUSTOMER_FILTER");
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new HttpError(
      400,
      "take must be an integer between 1 and 200",
      "INVALID_CUSTOMER_FILTER",
    );
  }

  return parsed;
};

export const searchCustomersHandler = async (req: Request, res: Response) => {
  const query =
    typeof req.query.q === "string"
      ? req.query.q
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
      : typeof req.query.query === "string"
        ? req.query.query
        : undefined;
  const take = parseSearchTake(req.query.take);
  const result = await searchCustomers(query, take);
  res.json(result);
};

export const listCustomerSalesHandler = async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const take = parseOptionalFilterTake(req.query.take);
  const result = await listCustomerSales({
    customerId: req.params.id,
    from,
    to,
    take,
  });
  res.json(result);
};

export const listCustomerWorkshopJobsHandler = async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const take = parseOptionalFilterTake(req.query.take);
  const result = await listCustomerWorkshopJobs({
    customerId: req.params.id,
    from,
    to,
    take,
  });
  res.json(result);
};

export const listCustomerBikesHandler = async (req: Request, res: Response) => {
  const result = await listCustomerBikes(req.params.id);
  res.json(result);
};

export const getCustomerBikeHistoryHandler = async (req: Request, res: Response) => {
  const result = await getCustomerBikeHistory(req.params.bikeId);
  res.json(result);
};

export const createCustomerBikeHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    label?: unknown;
    make?: unknown;
    model?: unknown;
    colour?: unknown;
    frameNumber?: unknown;
    serialNumber?: unknown;
    registrationNumber?: unknown;
    notes?: unknown;
  };

  if (body.label !== undefined && typeof body.label !== "string") {
    throw new HttpError(400, "label must be a string", "INVALID_CUSTOMER_BIKE");
  }
  if (body.make !== undefined && typeof body.make !== "string") {
    throw new HttpError(400, "make must be a string", "INVALID_CUSTOMER_BIKE");
  }
  if (body.model !== undefined && typeof body.model !== "string") {
    throw new HttpError(400, "model must be a string", "INVALID_CUSTOMER_BIKE");
  }
  if (body.colour !== undefined && typeof body.colour !== "string") {
    throw new HttpError(400, "colour must be a string", "INVALID_CUSTOMER_BIKE");
  }
  if (body.frameNumber !== undefined && typeof body.frameNumber !== "string") {
    throw new HttpError(400, "frameNumber must be a string", "INVALID_CUSTOMER_BIKE");
  }
  if (body.serialNumber !== undefined && typeof body.serialNumber !== "string") {
    throw new HttpError(400, "serialNumber must be a string", "INVALID_CUSTOMER_BIKE");
  }
  if (body.registrationNumber !== undefined && typeof body.registrationNumber !== "string") {
    throw new HttpError(400, "registrationNumber must be a string", "INVALID_CUSTOMER_BIKE");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_CUSTOMER_BIKE");
  }

  const result = await createCustomerBike(req.params.id, {
    label: body.label as string | undefined,
    make: body.make as string | undefined,
    model: body.model as string | undefined,
    colour: body.colour as string | undefined,
    frameNumber: body.frameNumber as string | undefined,
    serialNumber: body.serialNumber as string | undefined,
    registrationNumber: body.registrationNumber as string | undefined,
    notes: body.notes as string | undefined,
  });

  res.status(201).json(result);
};

export const getCustomerTimelineHandler = async (req: Request, res: Response) => {
  const result = await getCustomerTimeline(req.params.id);
  res.json(result);
};
