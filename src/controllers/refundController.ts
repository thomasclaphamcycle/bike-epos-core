import { RefundTenderType } from "@prisma/client";
import { Request, Response } from "express";
import { getRequestStaffActorId } from "../middleware/staffRole";
import {
  addRefundTender,
  completeRefund,
  createRefund,
  deleteRefundLine,
  deleteRefundTender,
  getRefundById,
  listCompletedRefunds,
  upsertRefundLine,
} from "../services/refundService";
import { HttpError } from "../utils/http";

const parseRefundTenderType = (value: unknown): RefundTenderType => {
  if (typeof value !== "string") {
    throw new HttpError(
      400,
      "tenderType must be one of CASH, CARD, VOUCHER, OTHER",
      "INVALID_REFUND_TENDER",
    );
  }

  const normalized = value.trim().toUpperCase();
  if (normalized !== "CASH" && normalized !== "CARD" && normalized !== "VOUCHER" && normalized !== "OTHER") {
    throw new HttpError(
      400,
      "tenderType must be one of CASH, CARD, VOUCHER, OTHER",
      "INVALID_REFUND_TENDER",
    );
  }

  return normalized as RefundTenderType;
};

const isJsonPrimitive = (value: unknown): value is string | number | boolean | null =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

const isJsonValue = (value: unknown): boolean => {
  if (isJsonPrimitive(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((entry) => isJsonValue(entry));
  }
  return false;
};

export const createRefundHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    saleId?: unknown;
  };

  if (body.saleId !== undefined && typeof body.saleId !== "string") {
    throw new HttpError(400, "saleId must be a string", "INVALID_SALE_ID");
  }

  const result = await createRefund({
    saleId: body.saleId,
    createdByStaffId: getRequestStaffActorId(req),
  });

  res.status(201).json(result);
};

export const getRefundHandler = async (req: Request, res: Response) => {
  const result = await getRefundById(req.params.refundId);
  res.json(result);
};

export const listRefundsHandler = async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const result = await listCompletedRefunds({ from, to });
  res.json(result);
};

export const upsertRefundLineHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    saleLineId?: unknown;
    quantity?: unknown;
  };

  if (body.saleLineId !== undefined && typeof body.saleLineId !== "string") {
    throw new HttpError(400, "saleLineId must be a string", "INVALID_SALE_LINE_ID");
  }
  if (body.quantity !== undefined && typeof body.quantity !== "number") {
    throw new HttpError(400, "quantity must be a number", "INVALID_REFUND_LINE");
  }

  const result = await upsertRefundLine(req.params.refundId, {
    saleLineId: body.saleLineId,
    quantity: body.quantity,
  });

  res.status(201).json(result);
};

export const deleteRefundLineHandler = async (req: Request, res: Response) => {
  const result = await deleteRefundLine(req.params.refundId, req.params.refundLineId);
  res.json(result);
};

export const addRefundTenderHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    tenderType?: unknown;
    amountPence?: unknown;
    meta?: unknown;
  };

  if (body.amountPence !== undefined && typeof body.amountPence !== "number") {
    throw new HttpError(400, "amountPence must be a number", "INVALID_REFUND_TENDER");
  }

  if (body.meta !== undefined && !isJsonValue(body.meta)) {
    throw new HttpError(400, "meta must be valid JSON", "INVALID_REFUND_TENDER");
  }

  const result = await addRefundTender(
    req.params.refundId,
    {
      tenderType: parseRefundTenderType(body.tenderType),
      amountPence: body.amountPence,
      meta: body.meta,
    },
    getRequestStaffActorId(req),
  );

  res.status(201).json(result);
};

export const deleteRefundTenderHandler = async (req: Request, res: Response) => {
  const result = await deleteRefundTender(req.params.refundId, req.params.tenderId);
  res.json(result);
};

export const completeRefundHandler = async (req: Request, res: Response) => {
  const result = await completeRefund(req.params.refundId);
  res.status(result.idempotent ? 200 : 201).json(result);
};
