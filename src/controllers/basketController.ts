import { Request, Response } from "express";
import {
  addBasketItem,
  attachCustomerToBasket,
  createBasket,
  getBasketById,
  removeBasketItem,
  updateBasketItemQuantity,
} from "../services/basketService";
import { HttpError } from "../utils/http";
import { checkoutBasketToSale } from "../services/salesService";
import { parsePaymentFromBody } from "./salesController";
import { getRequestStaffActorId } from "../middleware/staffRole";
import { resolveRequestLocation } from "../services/locationService";

export const createBasketHandler = async (_req: Request, res: Response) => {
  const body = ((_req.body ?? {}) as {
    customerId?: unknown;
    items?: Array<{
      variantId?: unknown;
      quantity?: unknown;
      unitPricePence?: unknown;
    }>;
  });

  if (body.items !== undefined && !Array.isArray(body.items)) {
    throw new HttpError(400, "items must be an array", "INVALID_BASKET_PRELOAD");
  }
  if (
    body.customerId !== undefined
    && body.customerId !== null
    && typeof body.customerId !== "string"
  ) {
    throw new HttpError(400, "customerId must be a uuid or null", "INVALID_CUSTOMER_ID");
  }

  const items = body.items?.map((item) => {
    if (!item || typeof item !== "object") {
      throw new HttpError(400, "Each basket preload item must be an object", "INVALID_BASKET_PRELOAD");
    }
    if (typeof item.variantId !== "string") {
      throw new HttpError(400, "variantId is required for basket preload items", "INVALID_BASKET_PRELOAD");
    }
    if (typeof item.quantity !== "number") {
      throw new HttpError(400, "quantity is required for basket preload items", "INVALID_BASKET_PRELOAD");
    }
    if (item.unitPricePence !== undefined && typeof item.unitPricePence !== "number") {
      throw new HttpError(400, "unitPricePence must be a number", "INVALID_BASKET_PRELOAD");
    }

    return {
      variantId: item.variantId,
      quantity: item.quantity,
      unitPricePence: item.unitPricePence,
    };
  });

  const basket = await createBasket({
    ...(items ? { items } : {}),
    ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
  });
  res.status(201).json(basket);
};

export const getBasketHandler = async (req: Request, res: Response) => {
  const basket = await getBasketById(req.params.id);
  res.json(basket);
};

export const addBasketItemHandler = async (req: Request, res: Response) => {
  const { barcode, variantId, quantity } = req.body as {
    barcode?: string;
    variantId?: string;
    quantity?: number;
  };

  const parsedQuantity = quantity ?? 1;
  const basket = await addBasketItem(req.params.id, {
    barcode,
    variantId,
    quantity: parsedQuantity,
  });

  res.status(201).json(basket);
};

export const updateBasketItemHandler = async (req: Request, res: Response) => {
  const { quantity } = req.body as { quantity?: number };
  if (quantity === undefined) {
    throw new HttpError(400, "quantity is required", "MISSING_QUANTITY");
  }

  const basket = await updateBasketItemQuantity(req.params.id, req.params.itemId, quantity);
  res.json(basket);
};

export const deleteBasketItemHandler = async (req: Request, res: Response) => {
  const basket = await removeBasketItem(req.params.id, req.params.itemId);
  res.json(basket);
};

export const attachCustomerToBasketHandler = async (req: Request, res: Response) => {
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

  const basket = await attachCustomerToBasket(req.params.id, body.customerId ?? null);
  res.json(basket);
};

export const checkoutBasketHandler = async (req: Request, res: Response) => {
  const payment = parsePaymentFromBody(req.body);
  const location = await resolveRequestLocation(req);
  const result = await checkoutBasketToSale(
    req.params.id,
    payment,
    getRequestStaffActorId(req),
    location.locationId ?? location.id,
  );
  res.status(result.idempotent ? 200 : 201).json({
    sale: result.sale,
    saleItems: result.saleItems,
    payment: result.payment,
  });
};
