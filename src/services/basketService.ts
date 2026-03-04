import { Basket, BasketItem, BasketStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { findBarcodeOrThrow } from "./productLookupService";
import { HttpError, isUuid } from "../utils/http";

type BasketWithItems = Basket & {
  items: Array<
    BasketItem & {
      variant: {
        id: string;
        sku: string;
        name: string | null;
        product: {
          id: string;
          name: string;
        };
      };
    }
  >;
};

type AddBasketItemInput = {
  barcode?: string;
  variantId?: string;
  quantity: number;
};

const getBasketWithItems = async (basketId: string): Promise<BasketWithItems | null> => {
  return prisma.basket.findUnique({
    where: { id: basketId },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          variant: {
            include: {
              product: true,
            },
          },
        },
      },
    },
  });
};

const validateBasketId = (basketId: string): void => {
  if (!isUuid(basketId)) {
    throw new HttpError(400, "Invalid basket id", "INVALID_BASKET_ID");
  }
};

const assertOpenBasket = (basket: Basket): void => {
  if (basket.status !== BasketStatus.OPEN) {
    throw new HttpError(409, "Basket is not open", "BASKET_NOT_OPEN");
  }
};

const toBasketResponse = (basket: BasketWithItems) => {
  const subtotalPence = basket.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
  const taxPence = 0;
  const totalPence = subtotalPence + taxPence;

  return {
    id: basket.id,
    status: basket.status,
    createdAt: basket.createdAt,
    updatedAt: basket.updatedAt,
    items: basket.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      sku: item.variant.sku,
      productName: item.variant.product.name,
      variantName: item.variant.name,
      quantity: item.quantity,
      unitPricePence: item.unitPrice,
      lineTotalPence: item.quantity * item.unitPrice,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    totals: {
      subtotalPence,
      taxPence,
      totalPence,
    },
  };
};

export const createBasket = async () => {
  const basket = await prisma.basket.create({
    data: { status: BasketStatus.OPEN },
  });

  const withItems = await getBasketWithItems(basket.id);
  if (!withItems) {
    throw new HttpError(500, "Could not load basket after create", "BASKET_LOAD_FAILED");
  }

  return toBasketResponse(withItems);
};

export const getBasketById = async (basketId: string) => {
  validateBasketId(basketId);

  const basket = await getBasketWithItems(basketId);
  if (!basket) {
    throw new HttpError(404, "Basket not found", "BASKET_NOT_FOUND");
  }

  return toBasketResponse(basket);
};

export const addBasketItem = async (basketId: string, input: AddBasketItemInput) => {
  validateBasketId(basketId);

  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new HttpError(400, "quantity must be a positive integer", "INVALID_QUANTITY");
  }

  if (!input.barcode && !input.variantId) {
    throw new HttpError(400, "barcode or variantId is required", "MISSING_ITEM_REFERENCE");
  }

  const basket = await prisma.basket.findUnique({ where: { id: basketId } });
  if (!basket) {
    throw new HttpError(404, "Basket not found", "BASKET_NOT_FOUND");
  }
  assertOpenBasket(basket);

  let variantId = input.variantId;

  if (input.barcode) {
    const barcode = await findBarcodeOrThrow(input.barcode);
    variantId = barcode.variantId;
  }

  if (!variantId) {
    throw new HttpError(400, "variantId is required", "MISSING_VARIANT_ID");
  }

  const variant = await prisma.variant.findUnique({ where: { id: variantId } });
  if (!variant) {
    throw new HttpError(404, "Variant not found", "VARIANT_NOT_FOUND");
  }

  const unitPrice = variant.retailPricePence;

  await prisma.basketItem.upsert({
    where: {
      basketId_variantId: {
        basketId,
        variantId,
      },
    },
    create: {
      basketId,
      variantId,
      quantity: input.quantity,
      unitPrice,
    },
    update: {
      quantity: {
        increment: input.quantity,
      },
    },
  });

  const updatedBasket = await getBasketWithItems(basketId);
  if (!updatedBasket) {
    throw new HttpError(500, "Could not load basket after add", "BASKET_LOAD_FAILED");
  }

  return toBasketResponse(updatedBasket);
};

export const updateBasketItemQuantity = async (
  basketId: string,
  itemId: string,
  quantity: number,
) => {
  validateBasketId(basketId);
  if (!isUuid(itemId)) {
    throw new HttpError(400, "Invalid item id", "INVALID_ITEM_ID");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new HttpError(400, "quantity must be a positive integer", "INVALID_QUANTITY");
  }

  const basket = await prisma.basket.findUnique({ where: { id: basketId } });
  if (!basket) {
    throw new HttpError(404, "Basket not found", "BASKET_NOT_FOUND");
  }
  assertOpenBasket(basket);

  const item = await prisma.basketItem.findUnique({ where: { id: itemId } });
  if (!item || item.basketId !== basketId) {
    throw new HttpError(404, "Basket item not found", "BASKET_ITEM_NOT_FOUND");
  }

  await prisma.basketItem.update({
    where: { id: itemId },
    data: { quantity },
  });

  const updatedBasket = await getBasketWithItems(basketId);
  if (!updatedBasket) {
    throw new HttpError(500, "Could not load basket after update", "BASKET_LOAD_FAILED");
  }

  return toBasketResponse(updatedBasket);
};

export const removeBasketItem = async (basketId: string, itemId: string) => {
  validateBasketId(basketId);
  if (!isUuid(itemId)) {
    throw new HttpError(400, "Invalid item id", "INVALID_ITEM_ID");
  }

  const basket = await prisma.basket.findUnique({ where: { id: basketId } });
  if (!basket) {
    throw new HttpError(404, "Basket not found", "BASKET_NOT_FOUND");
  }
  assertOpenBasket(basket);

  const item = await prisma.basketItem.findUnique({ where: { id: itemId } });
  if (!item || item.basketId !== basketId) {
    throw new HttpError(404, "Basket item not found", "BASKET_ITEM_NOT_FOUND");
  }

  await prisma.basketItem.delete({ where: { id: itemId } });

  const updatedBasket = await getBasketWithItems(basketId);
  if (!updatedBasket) {
    throw new HttpError(500, "Could not load basket after delete", "BASKET_LOAD_FAILED");
  }

  return toBasketResponse(updatedBasket);
};

export const checkoutBasket = async (basketId: string) => {
  validateBasketId(basketId);

  const basket = await prisma.basket.findUnique({ where: { id: basketId } });
  if (!basket) {
    throw new HttpError(404, "Basket not found", "BASKET_NOT_FOUND");
  }
  assertOpenBasket(basket);

  await prisma.basket.update({
    where: { id: basketId },
    data: { status: BasketStatus.CHECKED_OUT },
  });

  const updatedBasket = await getBasketWithItems(basketId);
  if (!updatedBasket) {
    throw new HttpError(500, "Could not load basket after checkout", "BASKET_LOAD_FAILED");
  }

  return toBasketResponse(updatedBasket);
};
