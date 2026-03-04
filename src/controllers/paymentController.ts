import { Request, Response } from "express";
import { RefundStatus } from "@prisma/client";
import { getRequestAuditActor } from "../middleware/staffRole";
import { getPaymentById, refundPaymentById } from "../services/workshopMoneyService";
import { HttpError } from "../utils/http";

const parseRefundStatus = (value: string | undefined): RefundStatus | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (
    value !== "RECORDED" &&
    value !== "PROCESSOR_PENDING" &&
    value !== "PROCESSOR_SUCCEEDED" &&
    value !== "PROCESSOR_FAILED"
  ) {
    throw new HttpError(
      400,
      "status must be RECORDED, PROCESSOR_PENDING, PROCESSOR_SUCCEEDED, or PROCESSOR_FAILED",
      "INVALID_REFUND_STATUS",
    );
  }

  return value;
};

export const refundPaymentHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    amountPence?: number;
    reason?: string;
    status?: string;
    processorRefundId?: string;
    idempotencyKey?: string;
  };

  if (body.reason !== undefined && typeof body.reason !== "string") {
    throw new HttpError(400, "reason must be a string", "INVALID_REFUND");
  }
  if (body.status !== undefined && typeof body.status !== "string") {
    throw new HttpError(400, "status must be a string", "INVALID_REFUND");
  }
  if (body.processorRefundId !== undefined && typeof body.processorRefundId !== "string") {
    throw new HttpError(400, "processorRefundId must be a string", "INVALID_REFUND");
  }
  if (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== "string") {
    throw new HttpError(400, "idempotencyKey must be a string", "INVALID_REFUND");
  }

  const result = await refundPaymentById(req.params.id, {
    amountPence: body.amountPence,
    reason: body.reason,
    status: parseRefundStatus(body.status),
    processorRefundId: body.processorRefundId,
    idempotencyKey: body.idempotencyKey,
  }, getRequestAuditActor(req));

  res.status(result.idempotent ? 200 : 201).json(result);
};

export const getPaymentHandler = async (req: Request, res: Response) => {
  const result = await getPaymentById(req.params.id);
  res.json(result);
};
