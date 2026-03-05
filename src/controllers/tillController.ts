import { Request, Response } from "express";
import { getRequestStaffActorId } from "../middleware/staffRole";
import {
  addPaidMovement,
  closeCashSession,
  getCashSessionSummary,
  getCashSessionSummaryCsv,
  getCurrentCashSession,
  listCashSessions,
  openCashSession,
  recordCashCount,
} from "../services/tillService";
import { HttpError } from "../utils/http";

export const openCashSessionHandler = async (req: Request, res: Response) => {
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

  const summary = await openCashSession({
    openingFloatPence: body.openingFloatPence,
    businessDate: body.businessDate,
    openedByStaffId: getRequestStaffActorId(req),
  });

  res.status(201).json(summary);
};

export const addTillMovementHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { type?: unknown; amountPence?: unknown; ref?: unknown };

  if (body.type !== undefined && typeof body.type !== "string") {
    throw new HttpError(400, "type must be a string", "INVALID_TILL_MOVEMENT");
  }
  if (body.amountPence !== undefined && typeof body.amountPence !== "number") {
    throw new HttpError(400, "amountPence must be a number", "INVALID_TILL_MOVEMENT");
  }
  if (body.ref !== undefined && typeof body.ref !== "string") {
    throw new HttpError(400, "ref must be a string", "INVALID_TILL_MOVEMENT");
  }

  const result = await addPaidMovement(req.params.id, {
    type: body.type,
    amountPence: body.amountPence,
    ref: body.ref,
    createdByStaffId: getRequestStaffActorId(req),
  });

  res.status(201).json(result);
};

export const recordCashCountHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { countedCashPence?: unknown; notes?: unknown };
  if (body.countedCashPence !== undefined && typeof body.countedCashPence !== "number") {
    throw new HttpError(400, "countedCashPence must be a number", "INVALID_CASH_COUNT");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_CASH_COUNT");
  }

  const result = await recordCashCount(req.params.id, {
    countedCashPence: body.countedCashPence,
    notes: body.notes,
    countedByStaffId: getRequestStaffActorId(req),
  });

  res.status(201).json(result);
};

export const closeCashSessionHandler = async (req: Request, res: Response) => {
  const result = await closeCashSession(req.params.id, getRequestStaffActorId(req));
  res.status(result.idempotent ? 200 : 201).json(result);
};

export const getCurrentCashSessionHandler = async (_req: Request, res: Response) => {
  const result = await getCurrentCashSession();
  res.json(result);
};

export const listCashSessionsHandler = async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const result = await listCashSessions({ from, to });
  res.json(result);
};

export const getCashSessionSummaryHandler = async (req: Request, res: Response) => {
  const result = await getCashSessionSummary(req.params.id);
  res.json(result);
};

export const getCashSessionSummaryCsvHandler = async (req: Request, res: Response) => {
  const csv = await getCashSessionSummaryCsv(req.params.id);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=\"cash-session-${req.params.id}-summary.csv\"`,
  );
  res.status(200).send(csv);
};
