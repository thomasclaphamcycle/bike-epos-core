import { Request, Response } from "express";
import { getRequestAuditActor } from "../middleware/staffRole";
import {
  applyCredit,
  getCreditBalance,
  issueCredit,
} from "../services/workshopMoneyService";
import { HttpError } from "../utils/http";

export const getCreditBalanceHandler = async (req: Request, res: Response) => {
  const customerId =
    typeof req.query.customerId === "string" ? req.query.customerId : undefined;
  const email = typeof req.query.email === "string" ? req.query.email : undefined;
  const phone = typeof req.query.phone === "string" ? req.query.phone : undefined;

  const result = await getCreditBalance({ customerId, email, phone });
  res.json(result);
};

export const issueCreditHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    customerId?: string;
    email?: string;
    phone?: string;
    amountPence?: number;
    notes?: string;
    sourceRef?: string;
    idempotencyKey?: string;
  };

  if (body.customerId !== undefined && typeof body.customerId !== "string") {
    throw new HttpError(400, "customerId must be a string", "INVALID_CREDIT_ISSUE");
  }
  if (body.email !== undefined && typeof body.email !== "string") {
    throw new HttpError(400, "email must be a string", "INVALID_CREDIT_ISSUE");
  }
  if (body.phone !== undefined && typeof body.phone !== "string") {
    throw new HttpError(400, "phone must be a string", "INVALID_CREDIT_ISSUE");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_CREDIT_ISSUE");
  }
  if (body.sourceRef !== undefined && typeof body.sourceRef !== "string") {
    throw new HttpError(400, "sourceRef must be a string", "INVALID_CREDIT_ISSUE");
  }
  if (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== "string") {
    throw new HttpError(400, "idempotencyKey must be a string", "INVALID_CREDIT_ISSUE");
  }

  const result = await issueCredit({
    customerId: body.customerId,
    email: body.email,
    phone: body.phone,
    amountPence: body.amountPence,
    notes: body.notes,
    sourceRef: body.sourceRef,
    idempotencyKey: body.idempotencyKey,
  }, getRequestAuditActor(req));

  res.status(result.idempotent ? 200 : 201).json(result);
};

export const applyCreditHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    saleId?: string;
    workshopJobId?: string;
    customerId?: string;
    email?: string;
    phone?: string;
    amountPence?: number;
    notes?: string;
    idempotencyKey?: string;
  };

  if (body.saleId !== undefined && typeof body.saleId !== "string") {
    throw new HttpError(400, "saleId must be a string", "INVALID_CREDIT_APPLY");
  }
  if (body.workshopJobId !== undefined && typeof body.workshopJobId !== "string") {
    throw new HttpError(400, "workshopJobId must be a string", "INVALID_CREDIT_APPLY");
  }
  if (body.customerId !== undefined && typeof body.customerId !== "string") {
    throw new HttpError(400, "customerId must be a string", "INVALID_CREDIT_APPLY");
  }
  if (body.email !== undefined && typeof body.email !== "string") {
    throw new HttpError(400, "email must be a string", "INVALID_CREDIT_APPLY");
  }
  if (body.phone !== undefined && typeof body.phone !== "string") {
    throw new HttpError(400, "phone must be a string", "INVALID_CREDIT_APPLY");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_CREDIT_APPLY");
  }
  if (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== "string") {
    throw new HttpError(400, "idempotencyKey must be a string", "INVALID_CREDIT_APPLY");
  }

  const result = await applyCredit({
    saleId: body.saleId,
    workshopJobId: body.workshopJobId,
    customerId: body.customerId,
    email: body.email,
    phone: body.phone,
    amountPence: body.amountPence,
    notes: body.notes,
    idempotencyKey: body.idempotencyKey,
  }, getRequestAuditActor(req));

  res.status(result.idempotent ? 200 : 201).json(result);
};
