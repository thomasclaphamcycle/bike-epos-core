import { PurchaseOrderStatus } from "@prisma/client";
import { Request, Response } from "express";
import { getRequestStaffActorId } from "../middleware/staffRole";
import {
  createPurchaseOrder,
  getPurchaseOrderById,
  listPurchaseOrders,
  receivePurchaseOrder,
  updatePurchaseOrder,
  updatePurchaseOrderItem,
  upsertPurchaseOrderItems,
} from "../services/purchasingService";
import { HttpError } from "../utils/http";
import { parseOptionalIntegerQuery } from "../utils/requestParsing";

const parsePurchaseOrderStatus = (
  value: string | undefined,
  code: string,
): PurchaseOrderStatus | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toUpperCase();
  if (
    normalized !== "DRAFT" &&
    normalized !== "SENT" &&
    normalized !== "PARTIALLY_RECEIVED" &&
    normalized !== "RECEIVED" &&
    normalized !== "CANCELLED"
  ) {
    throw new HttpError(
      400,
      "status must be one of DRAFT, SENT, PARTIALLY_RECEIVED, RECEIVED, CANCELLED",
      code,
    );
  }

  return normalized as PurchaseOrderStatus;
};

export const listPurchaseOrdersHandler = async (req: Request, res: Response) => {
  const result = await listPurchaseOrders({
    status: parsePurchaseOrderStatus(
      typeof req.query.status === "string" ? req.query.status : undefined,
      "INVALID_PURCHASE_ORDER_QUERY",
    ),
    supplierId: typeof req.query.supplierId === "string" ? req.query.supplierId : undefined,
    q: typeof req.query.q === "string" ? req.query.q : undefined,
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined,
    take: parseOptionalIntegerQuery(req.query.take, {
      code: "INVALID_PURCHASE_ORDER_QUERY",
      message: "take must be an integer",
    }),
    skip: parseOptionalIntegerQuery(req.query.skip, {
      code: "INVALID_PURCHASE_ORDER_QUERY",
      message: "skip must be an integer",
    }),
  });

  res.json(result);
};

export const createPurchaseOrderHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    supplierId?: string;
    orderedAt?: string;
    expectedAt?: string;
    notes?: string;
  };

  if (body.supplierId !== undefined && typeof body.supplierId !== "string") {
    throw new HttpError(400, "supplierId must be a string", "INVALID_PURCHASE_ORDER");
  }
  if (body.orderedAt !== undefined && typeof body.orderedAt !== "string") {
    throw new HttpError(400, "orderedAt must be a string", "INVALID_PURCHASE_ORDER");
  }
  if (body.expectedAt !== undefined && typeof body.expectedAt !== "string") {
    throw new HttpError(400, "expectedAt must be a string", "INVALID_PURCHASE_ORDER");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_PURCHASE_ORDER");
  }

  const po = await createPurchaseOrder(body);
  res.status(201).json(po);
};

export const getPurchaseOrderHandler = async (req: Request, res: Response) => {
  const po = await getPurchaseOrderById(req.params.id);
  res.json(po);
};

export const patchPurchaseOrderHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    status?: string;
    orderedAt?: string | null;
    expectedAt?: string | null;
    notes?: string | null;
  };

  if (body.status !== undefined && typeof body.status !== "string") {
    throw new HttpError(400, "status must be a string", "INVALID_PURCHASE_ORDER_UPDATE");
  }
  if (body.orderedAt !== undefined && body.orderedAt !== null && typeof body.orderedAt !== "string") {
    throw new HttpError(400, "orderedAt must be a string or null", "INVALID_PURCHASE_ORDER_UPDATE");
  }
  if (body.expectedAt !== undefined && body.expectedAt !== null && typeof body.expectedAt !== "string") {
    throw new HttpError(400, "expectedAt must be a string or null", "INVALID_PURCHASE_ORDER_UPDATE");
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string or null", "INVALID_PURCHASE_ORDER_UPDATE");
  }

  const po = await updatePurchaseOrder(req.params.id, {
    status: parsePurchaseOrderStatus(body.status, "INVALID_PURCHASE_ORDER_UPDATE"),
    orderedAt: body.orderedAt,
    expectedAt: body.expectedAt,
    notes: body.notes,
  });

  res.json(po);
};

export const addPurchaseOrderItemsHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    lines?: Array<{
      variantId?: string;
      quantityOrdered?: number;
      unitCostPence?: number;
    }>;
  };

  if (!Array.isArray(body.lines)) {
    throw new HttpError(400, "lines must be an array", "INVALID_PURCHASE_ORDER_ITEMS");
  }

  for (const line of body.lines) {
    if (line.variantId !== undefined && typeof line.variantId !== "string") {
      throw new HttpError(400, "variantId must be a string", "INVALID_PURCHASE_ORDER_ITEMS");
    }
    if (line.quantityOrdered !== undefined && typeof line.quantityOrdered !== "number") {
      throw new HttpError(
        400,
        "quantityOrdered must be a number",
        "INVALID_PURCHASE_ORDER_ITEMS",
      );
    }
    if (line.unitCostPence !== undefined && typeof line.unitCostPence !== "number") {
      throw new HttpError(400, "unitCostPence must be a number", "INVALID_PURCHASE_ORDER_ITEMS");
    }
  }

  const po = await upsertPurchaseOrderItems(req.params.id, body.lines);
  res.json(po);
};

export const patchPurchaseOrderItemHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    quantityOrdered?: number;
    unitCostPence?: number | null;
  };

  if (body.quantityOrdered !== undefined && typeof body.quantityOrdered !== "number") {
    throw new HttpError(400, "quantityOrdered must be a number", "INVALID_PURCHASE_ORDER_ITEMS");
  }
  if (
    body.unitCostPence !== undefined &&
    body.unitCostPence !== null &&
    typeof body.unitCostPence !== "number"
  ) {
    throw new HttpError(400, "unitCostPence must be a number or null", "INVALID_PURCHASE_ORDER_ITEMS");
  }

  const po = await updatePurchaseOrderItem(req.params.id, req.params.lineId, {
    quantityOrdered: body.quantityOrdered,
    unitCostPence: body.unitCostPence,
  });
  res.json(po);
};

export const receivePurchaseOrderHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    locationId?: string;
    lines?: Array<{
      purchaseOrderItemId?: string;
      quantity?: number;
      unitCostPence?: number;
    }>;
  };

  if (body.locationId !== undefined && typeof body.locationId !== "string") {
    throw new HttpError(400, "locationId must be a string", "INVALID_RECEIVING");
  }
  if (!Array.isArray(body.lines)) {
    throw new HttpError(400, "lines must be an array", "INVALID_RECEIVING");
  }

  for (const line of body.lines) {
    if (line.purchaseOrderItemId !== undefined && typeof line.purchaseOrderItemId !== "string") {
      throw new HttpError(400, "purchaseOrderItemId must be a string", "INVALID_RECEIVING");
    }
    if (line.quantity !== undefined && typeof line.quantity !== "number") {
      throw new HttpError(400, "quantity must be a number", "INVALID_RECEIVING");
    }
    if (line.unitCostPence !== undefined && typeof line.unitCostPence !== "number") {
      throw new HttpError(400, "unitCostPence must be a number", "INVALID_RECEIVING");
    }
  }

  const po = await receivePurchaseOrder(req.params.id, body, getRequestStaffActorId(req));
  res.json(po);
};
