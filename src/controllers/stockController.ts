import { Request, Response } from "express";
import { getRequestStaffActorId } from "../middleware/staffRole";
import { createStockAdjustment, getStockForVariant } from "../services/stockService";
import { HttpError } from "../utils/http";

export const getVariantStockHandler = async (req: Request, res: Response) => {
  const locationId = typeof req.query.locationId === "string" ? req.query.locationId : undefined;
  const stock = await getStockForVariant(req.params.variantId, locationId);
  res.json(stock);
};

export const createStockAdjustmentHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    variantId?: string;
    locationId?: string;
    quantityDelta?: number;
    note?: string;
    referenceType?: string;
    referenceId?: string;
    createdByStaffId?: string;
  };

  if (body.variantId !== undefined && typeof body.variantId !== "string") {
    throw new HttpError(400, "variantId must be a string", "INVALID_STOCK_ADJUSTMENT");
  }
  if (body.locationId !== undefined && typeof body.locationId !== "string") {
    throw new HttpError(400, "locationId must be a string", "INVALID_STOCK_ADJUSTMENT");
  }
  if (body.quantityDelta !== undefined && typeof body.quantityDelta !== "number") {
    throw new HttpError(400, "quantityDelta must be a number", "INVALID_STOCK_ADJUSTMENT");
  }
  if (body.note !== undefined && typeof body.note !== "string") {
    throw new HttpError(400, "note must be a string", "INVALID_STOCK_ADJUSTMENT");
  }
  if (body.referenceType !== undefined && typeof body.referenceType !== "string") {
    throw new HttpError(400, "referenceType must be a string", "INVALID_STOCK_ADJUSTMENT");
  }
  if (body.referenceId !== undefined && typeof body.referenceId !== "string") {
    throw new HttpError(400, "referenceId must be a string", "INVALID_STOCK_ADJUSTMENT");
  }
  if (body.createdByStaffId !== undefined && typeof body.createdByStaffId !== "string") {
    throw new HttpError(400, "createdByStaffId must be a string", "INVALID_STOCK_ADJUSTMENT");
  }

  const adjustment = await createStockAdjustment({
    ...body,
    createdByStaffId: body.createdByStaffId ?? getRequestStaffActorId(req),
  });

  res.status(201).json(adjustment);
};
