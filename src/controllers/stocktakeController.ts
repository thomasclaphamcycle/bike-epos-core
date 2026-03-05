import { Request, Response } from "express";
import { StocktakeStatus } from "@prisma/client";
import { getRequestStaffActorId } from "../middleware/staffRole";
import {
  cancelStocktake,
  createStocktake,
  deleteStocktakeLine,
  getStocktakeById,
  listStocktakes,
  postStocktake,
  upsertStocktakeLine,
} from "../services/stocktakeService";
import { HttpError } from "../utils/http";

const parseBooleanQuery = (value: string | undefined): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  throw new HttpError(400, "includePreview must be true or false", "INVALID_QUERY");
};

const parseStocktakeStatusQuery = (value: string | undefined): StocktakeStatus | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toUpperCase();
  if (normalized !== "OPEN" && normalized !== "POSTED" && normalized !== "CANCELLED") {
    throw new HttpError(
      400,
      "status must be one of OPEN, POSTED, CANCELLED",
      "INVALID_STOCKTAKE_QUERY",
    );
  }

  return normalized as StocktakeStatus;
};

const parseOptionalIntQuery = (
  value: string | undefined,
  field: "take" | "skip",
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new HttpError(400, `${field} must be an integer`, "INVALID_STOCKTAKE_QUERY");
  }

  return parsed;
};

export const listStocktakesHandler = async (req: Request, res: Response) => {
  const locationId = typeof req.query.locationId === "string" ? req.query.locationId : undefined;
  const status = parseStocktakeStatusQuery(
    typeof req.query.status === "string" ? req.query.status : undefined,
  );
  const take = parseOptionalIntQuery(
    typeof req.query.take === "string" ? req.query.take : undefined,
    "take",
  );
  const skip = parseOptionalIntQuery(
    typeof req.query.skip === "string" ? req.query.skip : undefined,
    "skip",
  );

  const result = await listStocktakes({ locationId, status, take, skip });
  res.json(result);
};

export const createStocktakeHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    locationId?: string;
    notes?: string;
  };

  if (body.locationId !== undefined && typeof body.locationId !== "string") {
    throw new HttpError(400, "locationId must be a string", "INVALID_STOCKTAKE");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_STOCKTAKE");
  }

  const stocktake = await createStocktake(body);
  res.status(201).json(stocktake);
};

export const getStocktakeHandler = async (req: Request, res: Response) => {
  const includePreview = parseBooleanQuery(
    typeof req.query.includePreview === "string" ? req.query.includePreview : undefined,
  );

  const stocktake = await getStocktakeById(req.params.id, includePreview ?? true);
  res.json(stocktake);
};

export const upsertStocktakeLineHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    variantId?: string;
    countedQty?: number;
  };

  if (body.variantId !== undefined && typeof body.variantId !== "string") {
    throw new HttpError(400, "variantId must be a string", "INVALID_STOCKTAKE_LINE");
  }
  if (body.countedQty !== undefined && typeof body.countedQty !== "number") {
    throw new HttpError(400, "countedQty must be a number", "INVALID_STOCKTAKE_LINE");
  }

  const stocktake = await upsertStocktakeLine(req.params.id, body);
  res.json(stocktake);
};

export const deleteStocktakeLineHandler = async (req: Request, res: Response) => {
  const stocktake = await deleteStocktakeLine(req.params.id, req.params.lineId);
  res.json(stocktake);
};

export const postStocktakeHandler = async (req: Request, res: Response) => {
  const stocktake = await postStocktake(req.params.id, getRequestStaffActorId(req));
  res.json(stocktake);
};

export const finalizeStocktakeHandler = postStocktakeHandler;

export const cancelStocktakeHandler = async (req: Request, res: Response) => {
  const stocktake = await cancelStocktake(req.params.id);
  res.json(stocktake);
};
