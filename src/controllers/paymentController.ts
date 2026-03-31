import { Request, Response } from "express";
import { RefundStatus } from "@prisma/client";
import { getRequestAuditActor, getRequestStaffActorId } from "../middleware/staffRole";
import { getPaymentById, refundPaymentById } from "../services/workshopMoneyService";
import {
  cancelPaymentIntentById,
  capturePaymentIntentById,
  createPaymentIntent,
  listPaymentIntents,
} from "../services/paymentIntentService";
import { emitEvent } from "../utils/domainEvent";
import { HttpError } from "../utils/http";
import { createRequestLogger } from "../utils/logger";

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
  const requestLogger = createRequestLogger(req);
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

  requestLogger.info("payments.refund.recorded", {
    resultStatus: result.idempotent ? "idempotent" : "succeeded",
    paymentId: req.params.id,
    refundId: result.refund.id,
  });
  emitEvent("payments.refund.recorded", {
    id: result.refund.id,
    type: "payments.refund.recorded",
    timestamp: new Date().toISOString(),
    paymentId: req.params.id,
    refundId: result.refund.id,
    resultStatus: result.idempotent ? "idempotent" : "succeeded",
  });
  res.status(result.idempotent ? 200 : 201).json(result);
};

export const getPaymentHandler = async (req: Request, res: Response) => {
  const result = await getPaymentById(req.params.id);
  res.json(result);
};

export const createPaymentIntentHandler = async (req: Request, res: Response) => {
  const requestLogger = createRequestLogger(req);
  const body = (req.body ?? {}) as {
    saleId?: string;
    amountPence?: number;
    provider?: string;
    externalRef?: string;
  };

  if (body.saleId !== undefined && typeof body.saleId !== "string") {
    throw new HttpError(400, "saleId must be a string", "INVALID_PAYMENT_INTENT");
  }
  if (body.amountPence !== undefined && typeof body.amountPence !== "number") {
    throw new HttpError(400, "amountPence must be a number", "INVALID_PAYMENT_INTENT");
  }
  if (body.provider !== undefined && typeof body.provider !== "string") {
    throw new HttpError(400, "provider must be a string", "INVALID_PAYMENT_INTENT");
  }
  if (body.externalRef !== undefined && typeof body.externalRef !== "string") {
    throw new HttpError(400, "externalRef must be a string", "INVALID_PAYMENT_INTENT");
  }

  const result = await createPaymentIntent(body, getRequestStaffActorId(req));
  requestLogger.info("payments.intent.created", {
    resultStatus: "succeeded",
    paymentIntentId: result.id,
    saleId: result.saleId,
    provider: result.provider,
  });
  emitEvent("payments.intent.created", {
    id: result.id,
    type: "payments.intent.created",
    timestamp: new Date().toISOString(),
    paymentIntentId: result.id,
    saleId: result.saleId,
    provider: result.provider,
    resultStatus: "succeeded",
  });
  res.status(201).json(result);
};

export const capturePaymentIntentHandler = async (req: Request, res: Response) => {
  const result = await capturePaymentIntentById(req.params.id, getRequestStaffActorId(req));
  res.status(result.idempotent ? 200 : 201).json(result);
};

export const cancelPaymentIntentHandler = async (req: Request, res: Response) => {
  const result = await cancelPaymentIntentById(req.params.id);
  res.status(result.idempotent ? 200 : 201).json(result);
};

export const listPaymentIntentsHandler = async (req: Request, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;

  const result = await listPaymentIntents({
    status,
    provider,
    from,
    to,
  });
  res.json(result);
};
