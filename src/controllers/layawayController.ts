import { PaymentMethod } from "@prisma/client";
import { Request, Response } from "express";
import { getRequestStaffActorId } from "../middleware/staffRole";
import {
  cancelLayaway,
  completeLayaway,
  createLayawayFromBasket,
  getLayaway,
  listLayaways,
} from "../services/layawayService";
import { resolveRequestLocation } from "../services/locationService";
import { HttpError } from "../utils/http";

const parsePaymentMethod = (value: unknown): PaymentMethod | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value !== "CASH" && value !== "CARD" && value !== "OTHER") {
    throw new HttpError(400, "paymentMethod must be CASH, CARD, or OTHER", "INVALID_PAYMENT_METHOD");
  }
  return value;
};

const parseBooleanQuery = (value: unknown, field: string) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be true or false`, "INVALID_QUERY");
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new HttpError(400, `${field} must be true or false`, "INVALID_QUERY");
};

export const createLayawayFromBasketHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    deposit?: {
      paymentMethod?: unknown;
      amountPence?: unknown;
      providerRef?: unknown;
    };
    expiryDays?: unknown;
    expiresAt?: unknown;
    notes?: unknown;
  };

  const deposit = body.deposit
    ? {
        paymentMethod: parsePaymentMethod(body.deposit.paymentMethod),
        amountPence: typeof body.deposit.amountPence === "number" ? body.deposit.amountPence : undefined,
        providerRef: typeof body.deposit.providerRef === "string" ? body.deposit.providerRef : undefined,
      }
    : undefined;
  if (body.deposit && body.deposit.amountPence !== undefined && typeof body.deposit.amountPence !== "number") {
    throw new HttpError(400, "deposit.amountPence must be a number", "INVALID_LAYAWAY_DEPOSIT");
  }
  if (body.expiryDays !== undefined && typeof body.expiryDays !== "number") {
    throw new HttpError(400, "expiryDays must be a number", "INVALID_LAYAWAY_EXPIRY");
  }
  if (body.expiresAt !== undefined && typeof body.expiresAt !== "string") {
    throw new HttpError(400, "expiresAt must be a string", "INVALID_LAYAWAY_EXPIRY");
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string or null", "INVALID_LAYAWAY");
  }

  const location = await resolveRequestLocation(req);
  const result = await createLayawayFromBasket(
    req.params.id,
    {
      ...(deposit ? { deposit } : {}),
      ...(typeof body.expiryDays === "number" ? { expiryDays: body.expiryDays } : {}),
      ...(typeof body.expiresAt === "string" ? { expiresAt: body.expiresAt } : {}),
      ...(body.notes !== undefined ? { notes: body.notes as string | null } : {}),
    },
    getRequestStaffActorId(req),
    location.locationId ?? location.id,
  );
  res.status(201).json(result);
};

export const listLayawaysHandler = async (req: Request, res: Response) => {
  const includeClosed = parseBooleanQuery(req.query.includeClosed, "includeClosed");
  res.json(await listLayaways({ includeClosed }));
};

export const getLayawayHandler = async (req: Request, res: Response) => {
  res.json(await getLayaway(req.params.id));
};

export const cancelLayawayHandler = async (req: Request, res: Response) => {
  res.json(await cancelLayaway(req.params.id, getRequestStaffActorId(req)));
};

export const completeLayawayHandler = async (req: Request, res: Response) => {
  res.json(await completeLayaway(req.params.id, getRequestStaffActorId(req)));
};
