import { Request, Response } from "express";
import { getRequestStaffActorId } from "../middleware/staffRole";
import { HttpError } from "../utils/http";
import {
  attachCashMovementReceiptByToken,
  closeCurrentRegisterBlind,
  createCashMovementReceiptToken,
  createManagementCashMovement,
  getCurrentRegisterSession,
  getManagementCashMovements,
  getRegisterHistory,
  openRegisterSession,
} from "../services/managementCashService";

export const openRegisterHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    openingFloatPence?: unknown;
    businessDate?: unknown;
  };

  if (body.openingFloatPence !== undefined && typeof body.openingFloatPence !== "number") {
    throw new HttpError(400, "openingFloatPence must be a number", "INVALID_CASH_SESSION");
  }
  if (body.businessDate !== undefined && typeof body.businessDate !== "string") {
    throw new HttpError(400, "businessDate must be a string", "INVALID_CASH_SESSION");
  }

  const result = await openRegisterSession({
    openingFloatPence: body.openingFloatPence,
    businessDate: body.businessDate,
    openedByStaffId: getRequestStaffActorId(req),
  });

  res.status(201).json(result);
};

export const closeRegisterHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    countedAmountPence?: unknown;
    notes?: unknown;
  };

  if (body.countedAmountPence !== undefined && typeof body.countedAmountPence !== "number") {
    throw new HttpError(400, "countedAmountPence must be a number", "INVALID_CASH_COUNT");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_CASH_COUNT");
  }

  const result = await closeCurrentRegisterBlind({
    countedAmountPence: body.countedAmountPence,
    notes: body.notes,
    closedByStaffId: getRequestStaffActorId(req),
  });

  res.status(result.idempotent ? 200 : 201).json(result);
};

export const getCurrentRegisterHandler = async (_req: Request, res: Response) => {
  const result = await getCurrentRegisterSession();
  res.json(result);
};

export const getRegisterHistoryHandler = async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;

  const result = await getRegisterHistory({ from, to });
  res.json(result);
};

export const createManagementCashMovementHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    type?: unknown;
    amountPence?: unknown;
    reason?: unknown;
    notes?: unknown;
  };

  if (body.type !== undefined && typeof body.type !== "string") {
    throw new HttpError(400, "type must be a string", "INVALID_CASH_MOVEMENT");
  }
  if (body.amountPence !== undefined && typeof body.amountPence !== "number") {
    throw new HttpError(400, "amountPence must be a number", "INVALID_CASH_MOVEMENT");
  }
  if (body.reason !== undefined && typeof body.reason !== "string") {
    throw new HttpError(400, "reason must be a string", "INVALID_CASH_MOVEMENT");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_CASH_MOVEMENT");
  }

  const result = await createManagementCashMovement({
    type: body.type,
    amountPence: body.amountPence,
    reason: body.reason,
    notes: body.notes,
    createdByStaffId: getRequestStaffActorId(req),
  });

  res.status(201).json(result);
};

export const listManagementCashMovementsHandler = async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const result = await getManagementCashMovements({ from, to });
  res.json(result);
};

export const createCashMovementReceiptTokenHandler = async (req: Request, res: Response) => {
  const result = await createCashMovementReceiptToken(req.params.id);
  res.status(201).json(result);
};

export const publicReceiptUploadHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { imageDataUrl?: unknown };
  if (typeof body.imageDataUrl !== "string") {
    throw new HttpError(400, "imageDataUrl must be a string", "INVALID_RECEIPT_IMAGE");
  }

  const result = await attachCashMovementReceiptByToken(req.params.token, body.imageDataUrl);
  res.status(201).json(result);
};
