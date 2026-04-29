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
  reopenBasketFromUnpaidSale,
} from "../services/salesService";
import {
  SALES_HISTORY_STATUS_VALUES,
  listSalesHistory,
  type SalesHistoryStatus,
} from "../services/salesHistoryService";
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
  const result = await listSales({ from, to, locationId: location.locationId ?? location.id });
  res.json(result);
};

const parsePositiveIntegerQuery = (
  value: unknown,
  field: "page" | "pageSize",
  fallback: number,
) => {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new HttpError(
      400,
      `${field} must be a positive integer`,
      `INVALID_SALES_HISTORY_${field.toUpperCase()}`,
    );
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(
      400,
      `${field} must be a positive integer`,
      `INVALID_SALES_HISTORY_${field.toUpperCase()}`,
    );
  }

  return field === "pageSize" ? Math.min(parsed, 100) : parsed;
};

const parseSalesHistoryStatuses = (value: unknown): SalesHistoryStatus[] | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(
      400,
      "status must be a comma-separated list of draft or complete",
      "INVALID_SALES_HISTORY_STATUS",
    );
  }

  const statuses = Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0),
    ),
  );

  if (statuses.length === 0) {
    return undefined;
  }

  const invalidStatus = statuses.find(
    (status) => !SALES_HISTORY_STATUS_VALUES.includes(status as SalesHistoryStatus),
  );
  if (invalidStatus) {
    throw new HttpError(
      400,
      "status must be a comma-separated list of draft or complete",
      "INVALID_SALES_HISTORY_STATUS",
    );
  }

  return statuses as SalesHistoryStatus[];
};

export const listSaleHistoryHandler = async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const status = parseSalesHistoryStatuses(req.query.status);
  const storeId = typeof req.query.storeId === "string" ? req.query.storeId : undefined;
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;
  const page = parsePositiveIntegerQuery(req.query.page, "page", 1);
  const pageSize = parsePositiveIntegerQuery(req.query.pageSize, "pageSize", 20);

  const result = await listSalesHistory({
    q,
    statuses: status,
    storeId,
    dateFrom,
    dateTo,
    page,
    pageSize,
  });
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
    locationId: location.locationId ?? location.id,
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

export const reopenBasketFromSaleHandler = async (req: Request, res: Response) => {
  const result = await reopenBasketFromUnpaidSale(req.params.saleId);
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
