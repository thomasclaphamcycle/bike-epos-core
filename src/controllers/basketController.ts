import { Request, Response } from "express";
import {
  addBasketItem,
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
  const basket = await createBasket();
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
