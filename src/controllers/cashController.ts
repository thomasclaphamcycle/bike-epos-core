import { Request, Response } from "express";
import { getRequestStaffActorId } from "../middleware/staffRole";
import { createCashMovement, getCashSummary, listCashMovements } from "../services/cashService";
import { HttpError } from "../utils/http";

export const createCashMovementHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    type?: unknown;
    amountPence?: unknown;
    note?: unknown;
    locationId?: unknown;
  };

  if (body.type !== undefined && typeof body.type !== "string") {
    throw new HttpError(400, "type must be a string", "INVALID_CASH_MOVEMENT");
  }
  if (body.amountPence !== undefined && typeof body.amountPence !== "number") {
    throw new HttpError(400, "amountPence must be a number", "INVALID_CASH_MOVEMENT");
  }
  if (body.note !== undefined && typeof body.note !== "string") {
    throw new HttpError(400, "note must be a string", "INVALID_CASH_MOVEMENT");
  }
  if (body.locationId !== undefined && typeof body.locationId !== "string") {
    throw new HttpError(400, "locationId must be a string", "INVALID_CASH_MOVEMENT");
  }

  const result = await createCashMovement({
    type: body.type ? body.type.toUpperCase() as "FLOAT" | "PAID_IN" | "PAID_OUT" : undefined,
    amountPence: body.amountPence,
    note: body.note,
    locationId: body.locationId,
    createdByStaffId: getRequestStaffActorId(req),
  });

  res.status(201).json(result);
};

export const listCashMovementsHandler = async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;

  const result = await listCashMovements({ from, to });
  res.json(result);
};

export const getCashSummaryHandler = async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;

  const result = await getCashSummary({ from, to });
  res.json(result);
};
