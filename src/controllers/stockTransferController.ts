import { StockTransferStatus } from "@prisma/client";
import { Request, Response } from "express";
import { getRequestAuditActor } from "../middleware/staffRole";
import {
  cancelStockTransfer,
  createStockTransfer,
  getStockTransferById,
  listStockTransfers,
  receiveStockTransfer,
  sendStockTransfer,
} from "../services/stockTransferService";
import { HttpError } from "../utils/http";

const parseStockTransferStatus = (value: string | undefined): StockTransferStatus | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toUpperCase();
  if (
    normalized !== "DRAFT" &&
    normalized !== "SENT" &&
    normalized !== "RECEIVED" &&
    normalized !== "CANCELLED"
  ) {
    throw new HttpError(
      400,
      "status must be one of DRAFT, SENT, RECEIVED, CANCELLED",
      "INVALID_STOCK_TRANSFER_QUERY",
    );
  }

  return normalized as StockTransferStatus;
};

const parseOptionalIntQuery = (value: string | undefined, field: "take" | "skip") => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new HttpError(400, `${field} must be an integer`, "INVALID_STOCK_TRANSFER_QUERY");
  }

  return parsed;
};

export const listStockTransfersHandler = async (req: Request, res: Response) => {
  const result = await listStockTransfers({
    status: parseStockTransferStatus(
      typeof req.query.status === "string" ? req.query.status : undefined,
    ),
    fromLocationId: typeof req.query.fromLocationId === "string" ? req.query.fromLocationId : undefined,
    toLocationId: typeof req.query.toLocationId === "string" ? req.query.toLocationId : undefined,
    take: parseOptionalIntQuery(typeof req.query.take === "string" ? req.query.take : undefined, "take"),
    skip: parseOptionalIntQuery(typeof req.query.skip === "string" ? req.query.skip : undefined, "skip"),
  });

  res.json(result);
};

export const createStockTransferHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    fromLocationId?: string;
    toLocationId?: string;
    notes?: string;
    lines?: Array<{
      variantId?: string;
      quantity?: number;
    }>;
  };

  if (body.fromLocationId !== undefined && typeof body.fromLocationId !== "string") {
    throw new HttpError(400, "fromLocationId must be a string", "INVALID_STOCK_TRANSFER");
  }
  if (body.toLocationId !== undefined && typeof body.toLocationId !== "string") {
    throw new HttpError(400, "toLocationId must be a string", "INVALID_STOCK_TRANSFER");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_STOCK_TRANSFER");
  }
  if (!Array.isArray(body.lines)) {
    throw new HttpError(400, "lines must be an array", "INVALID_STOCK_TRANSFER");
  }

  for (const line of body.lines) {
    if (line.variantId !== undefined && typeof line.variantId !== "string") {
      throw new HttpError(400, "line variantId must be a string", "INVALID_STOCK_TRANSFER");
    }
    if (line.quantity !== undefined && typeof line.quantity !== "number") {
      throw new HttpError(400, "line quantity must be a number", "INVALID_STOCK_TRANSFER");
    }
  }

  const transfer = await createStockTransfer(body, getRequestAuditActor(req));
  res.status(201).json(transfer);
};

export const getStockTransferHandler = async (req: Request, res: Response) => {
  const transfer = await getStockTransferById(req.params.id);
  res.json(transfer);
};

export const sendStockTransferHandler = async (req: Request, res: Response) => {
  const transfer = await sendStockTransfer(req.params.id, getRequestAuditActor(req));
  res.json(transfer);
};

export const receiveStockTransferHandler = async (req: Request, res: Response) => {
  const transfer = await receiveStockTransfer(req.params.id, getRequestAuditActor(req));
  res.json(transfer);
};

export const cancelStockTransferHandler = async (req: Request, res: Response) => {
  const transfer = await cancelStockTransfer(req.params.id, getRequestAuditActor(req));
  res.json(transfer);
};
