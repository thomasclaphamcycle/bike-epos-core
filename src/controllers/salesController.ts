import { Request, Response } from "express";
import { PaymentMethod, SaleTenderMethod } from "@prisma/client";
import {
  addSaleTender,
  attachCustomerToSale,
  completeSaleIfEligible,
  createExchangeSale,
  createSaleReturn,
  deleteSaleTender,
  getSaleById,
  listSaleTenders,
  listSales,
} from "../services/salesService";
import { HttpError } from "../utils/http";
import { getRequestAuditActor, getRequestStaffActorId } from "../middleware/staffRole";
import { resolveRequestLocation } from "../services/locationService";

export const getSaleHandler = async (req: Request, res: Response) => {
  const result = await getSaleById(req.params.id);
  res.json(result);
};

export const listSalesHandler = async (req: Request, res: Response) => {
  const from =
    typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;

  const location = await resolveRequestLocation(req);
  const result = await listSales({ from, to, locationId: location.id });
  res.json(result);
};

const parsePaymentMethod = (
  value: string | undefined,
  fieldName: "paymentMethod" | "refund.method",
): PaymentMethod | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value !== "CASH" && value !== "CARD" && value !== "OTHER") {
    throw new HttpError(
      400,
      `${fieldName} must be one of CASH, CARD, OTHER`,
      "INVALID_PAYMENT_METHOD",
    );
  }
  return value as PaymentMethod;
};

const parseSaleTenderMethod = (value: unknown): SaleTenderMethod => {
  if (typeof value !== "string") {
    throw new HttpError(
      400,
      "method must be one of CASH, CARD, BANK_TRANSFER, VOUCHER",
      "INVALID_SALE_TENDER",
    );
  }
  const normalized = value.trim().toUpperCase();
  if (
    normalized !== "CASH" &&
    normalized !== "CARD" &&
    normalized !== "BANK_TRANSFER" &&
    normalized !== "VOUCHER"
  ) {
    throw new HttpError(
      400,
      "method must be one of CASH, CARD, BANK_TRANSFER, VOUCHER",
      "INVALID_SALE_TENDER",
    );
  }
  return normalized as SaleTenderMethod;
};

export const parsePaymentFromBody = (body: unknown): {
  paymentMethod?: PaymentMethod;
  amountPence?: number;
  providerRef?: string;
} => {
  if (!body || typeof body !== "object") {
    return {};
  }

  const payload = body as {
    paymentMethod?: string;
    amountPence?: number;
    providerRef?: string;
  };

  const paymentMethod = parsePaymentMethod(payload.paymentMethod, "paymentMethod");

  return {
    paymentMethod,
    amountPence: payload.amountPence,
    providerRef: payload.providerRef,
  };
};

export const createSaleReturnHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    items?: Array<{ saleItemId?: string; quantity?: number }>;
    refund?: {
      method?: string;
      amountPence?: number;
      providerRef?: string;
    };
  };

  const items = (body.items ?? []).map((item) => ({
    saleItemId: item.saleItemId ?? "",
    quantity: item.quantity ?? 0,
  }));

  let refund: { method?: PaymentMethod; amountPence?: number; providerRef?: string } = {};
  if (body.refund !== undefined) {
    if (!body.refund || typeof body.refund !== "object") {
      throw new HttpError(400, "refund must be an object", "INVALID_REFUND");
    }

    refund = {
      method: parsePaymentMethod(body.refund.method, "refund.method"),
      amountPence: body.refund.amountPence,
      providerRef: body.refund.providerRef,
    };
  }

  const result = await createSaleReturn(req.params.saleId, items, refund);
  res.status(201).json(result);
};

export const createExchangeSaleHandler = async (req: Request, res: Response) => {
  const location = await resolveRequestLocation(req);
  const result = await createExchangeSale(req.params.saleId, {
    staffActorId: getRequestStaffActorId(req),
    locationId: location.id,
    auditActor: getRequestAuditActor(req),
  });
  res.status(result.idempotent ? 200 : 201).json(result);
};

export const attachCustomerToSaleHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { customerId?: string | null };
  if (!Object.prototype.hasOwnProperty.call(body, "customerId")) {
    throw new HttpError(
      400,
      "customerId is required and must be a uuid or null",
      "INVALID_CUSTOMER_ID",
    );
  }

  if (body.customerId !== null && typeof body.customerId !== "string") {
    throw new HttpError(
      400,
      "customerId is required and must be a uuid or null",
      "INVALID_CUSTOMER_ID",
    );
  }

  const result = await attachCustomerToSale(req.params.saleId, body.customerId ?? null);
  res.json(result);
};

export const completeSaleHandler = async (req: Request, res: Response) => {
  const staffActorId = getRequestStaffActorId(req);
  const result = await completeSaleIfEligible(
    req.params.saleId,
    staffActorId ? { staffActorId } : {},
  );

  res.json(result);
};

export const addSaleTenderHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    method?: unknown;
    amountPence?: unknown;
  };

  const amountPence =
    typeof body.amountPence === "number" ? body.amountPence : Number.NaN;

  const result = await addSaleTender(
    req.params.saleId,
    {
      method: parseSaleTenderMethod(body.method),
      amountPence,
    },
    getRequestStaffActorId(req),
  );

  res.status(201).json(result);
};

export const listSaleTendersHandler = async (req: Request, res: Response) => {
  const result = await listSaleTenders(req.params.saleId);
  res.json(result);
};

export const deleteSaleTenderHandler = async (req: Request, res: Response) => {
  const result = await deleteSaleTender(req.params.saleId, req.params.tenderId);
  res.json(result);
};
