import { Request, Response } from "express";
import { PaymentMethod } from "@prisma/client";
import {
  attachCustomerToSale,
  completeSaleIfEligible,
  createSaleReturn,
  getSaleById,
  listSales,
} from "../services/salesService";
import { HttpError } from "../utils/http";
import { getRequestStaffActorId } from "../middleware/staffRole";

export const getSaleHandler = async (req: Request, res: Response) => {
  const result = await getSaleById(req.params.id);
  res.json(result);
};

export const listSalesHandler = async (req: Request, res: Response) => {
  const from =
    typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;

  const result = await listSales({ from, to });
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
  const result = await completeSaleIfEligible(req.params.saleId, {
    staffActorId: getRequestStaffActorId(req),
  });

  res.json(result);
};
