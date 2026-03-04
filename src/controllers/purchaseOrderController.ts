import { Request, Response } from "express";
import { getRequestStaffActorId } from "../middleware/staffRole";
import {
  createPurchaseOrder,
  getPurchaseOrderById,
  receivePurchaseOrder,
  upsertPurchaseOrderItems,
} from "../services/purchasingService";
import { HttpError } from "../utils/http";

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

export const receivePurchaseOrderHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    locationId?: string;
    lines?: Array<{
      purchaseOrderItemId?: string;
      quantity?: number;
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
  }

  const po = await receivePurchaseOrder(req.params.id, body, getRequestStaffActorId(req));
  res.json(po);
};
