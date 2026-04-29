import { Basket, BasketItem, BasketStatus, PosSaleSource, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { findBarcodeOrThrow } from "./productLookupService";
import { HttpError, isUuid } from "../utils/http";
import {
  toPosLineItemType,
  WORKSHOP_SERVICE_TEMPLATE_LABOUR_SKU_PREFIX,
} from "./posLineItemType";
import { buildPosSaleSourceSummary } from "./posSaleSource";

type BasketWithItems = Basket & {
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  } | null;
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

type AddBasketServiceTemplateInput = {
  templateId?: string;
};

type CreateBasketInput = {
  customerId?: string | null;
  source?: PosSaleSource;
  sourceRef?: string | null;
  items?: Array<{
    variantId: string;
    quantity: number;
    unitPricePence?: number;
  }>;
};

const getBasketWithItems = async (basketId: string): Promise<BasketWithItems | null> => {
  return prisma.basket.findUnique({
    where: { id: basketId },
    include: {
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
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

const getOrCreateTemplateLabourVariantTx = async (
  tx: Prisma.TransactionClient,
  template: { id: string; name: string },
) => {
  const sku = `${WORKSHOP_SERVICE_TEMPLATE_LABOUR_SKU_PREFIX}${template.id}`;
  const existing = await tx.variant.findUnique({
    where: { sku },
    select: {
      id: true,
      productId: true,
      retailPricePence: true,
    },
  });

  if (existing) {
    await tx.product.update({
      where: { id: existing.productId },
      data: {
        name: template.name,
        brand: "Internal",
        description: "Service template labour line item for POS checkout",
        isActive: true,
      },
    });
    return existing;
  }

  const serviceProduct = await tx.product.create({
    data: {
      name: template.name,
      brand: "Internal",
      description: "Service template labour line item for POS checkout",
    },
    select: { id: true },
  });

  return tx.variant.create({
    data: {
      productId: serviceProduct.id,
      sku,
      name: null,
      option: "Service",
      retailPrice: new Prisma.Decimal(0),
      retailPricePence: 0,
    },
    select: {
      id: true,
      productId: true,
      retailPricePence: true,
    },
  });
};

const upsertBasketLineTx = async (
  tx: Prisma.TransactionClient,
  input: {
    basketId: string;
    variantId: string;
    quantity: number;
    unitPrice: number;
  },
) => {
  await tx.basketItem.upsert({
    where: {
      basketId_variantId: {
        basketId: input.basketId,
        variantId: input.variantId,
      },
    },
    create: {
      basketId: input.basketId,
      variantId: input.variantId,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
    },
    update: {
      quantity: {
        increment: input.quantity,
      },
    },
  });
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
    customer: basket.customer
      ? {
          id: basket.customer.id,
          name: [basket.customer.firstName, basket.customer.lastName].filter(Boolean).join(" ").trim(),
          firstName: basket.customer.firstName,
          lastName: basket.customer.lastName,
          email: basket.customer.email,
          phone: basket.customer.phone,
        }
      : null,
    status: basket.status,
    ...buildPosSaleSourceSummary(basket.source, basket.sourceRef),
    createdAt: basket.createdAt,
    updatedAt: basket.updatedAt,
    items: basket.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      type: toPosLineItemType(item.variant.sku),
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

export const createBasket = async (input: CreateBasketInput = {}) => {
  const requestedCustomerId = input.customerId ?? null;
  const requestedSource = input.source ?? PosSaleSource.RETAIL;
  const requestedSourceRef = input.sourceRef?.trim() || null;
  const requestedItems = Array.isArray(input.items) ? input.items : [];

  for (const item of requestedItems) {
    if (typeof item.variantId !== "string" || item.variantId.trim().length === 0) {
      throw new HttpError(400, "variantId is required", "MISSING_VARIANT_ID");
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new HttpError(400, "quantity must be a positive integer", "INVALID_QUANTITY");
    }
    if (
      item.unitPricePence !== undefined
      && (!Number.isInteger(item.unitPricePence) || item.unitPricePence < 0)
    ) {
      throw new HttpError(400, "unitPricePence must be a non-negative integer", "INVALID_UNIT_PRICE");
    }
  }

  if (requestedCustomerId !== null && !isUuid(requestedCustomerId)) {
    throw new HttpError(400, "customerId must be a valid UUID", "INVALID_CUSTOMER_ID");
  }

  const basketId = await prisma.$transaction(async (tx) => {
    if (requestedCustomerId) {
      const customer = await tx.customer.findUnique({
        where: { id: requestedCustomerId },
        select: { id: true },
      });
      if (!customer) {
        throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
      }
    }

    const basket = await tx.basket.create({
      data: {
        status: BasketStatus.OPEN,
        customerId: requestedCustomerId,
        source: requestedSource,
        sourceRef: requestedSourceRef,
      },
      select: { id: true },
    });

    if (requestedItems.length > 0) {
      const variants = await tx.variant.findMany({
        where: {
          id: {
            in: requestedItems.map((item) => item.variantId),
          },
        },
        select: {
          id: true,
          retailPricePence: true,
        },
      });

      const variantById = new Map(variants.map((variant) => [variant.id, variant]));
      if (variantById.size !== new Set(requestedItems.map((item) => item.variantId)).size) {
        throw new HttpError(404, "One or more basket preload variants were not found", "VARIANT_NOT_FOUND");
      }

      const mergedItems = new Map<string, { variantId: string; quantity: number; unitPrice: number }>();
      for (const item of requestedItems) {
        const variant = variantById.get(item.variantId);
        if (!variant) {
          throw new HttpError(404, "Variant not found", "VARIANT_NOT_FOUND");
        }

        const unitPrice = item.unitPricePence ?? variant.retailPricePence;
        const existing = mergedItems.get(item.variantId);
        if (existing && existing.unitPrice !== unitPrice) {
          throw new HttpError(
            409,
            "Preloaded basket lines with the same variant must use the same unit price",
            "BASKET_PRELOAD_PRICE_CONFLICT",
          );
        }

        mergedItems.set(item.variantId, {
          variantId: item.variantId,
          quantity: (existing?.quantity ?? 0) + item.quantity,
          unitPrice,
        });
      }

      await tx.basketItem.createMany({
        data: Array.from(mergedItems.values()).map((item) => ({
          basketId: basket.id,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      });
    }

    return basket.id;
  });

  const withItems = await getBasketWithItems(basketId);
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

export const attachCustomerToBasket = async (basketId: string, customerId: string | null) => {
  validateBasketId(basketId);

  if (customerId !== null && !isUuid(customerId)) {
    throw new HttpError(400, "Invalid customer id", "INVALID_CUSTOMER_ID");
  }

  await prisma.$transaction(async (tx) => {
    const basket = await tx.basket.findUnique({ where: { id: basketId } });
    if (!basket) {
      throw new HttpError(404, "Basket not found", "BASKET_NOT_FOUND");
    }
    assertOpenBasket(basket);

    if (customerId !== null) {
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
        select: { id: true },
      });
      if (!customer) {
        throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
      }
    }

    await tx.basket.update({
      where: { id: basketId },
      data: { customerId },
    });
  });

  const updatedBasket = await getBasketWithItems(basketId);
  if (!updatedBasket) {
    throw new HttpError(500, "Could not load basket after customer update", "BASKET_LOAD_FAILED");
  }

  return toBasketResponse(updatedBasket);
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

  await prisma.$transaction(async (tx) => {
    await upsertBasketLineTx(tx, {
      basketId,
      variantId,
      quantity: input.quantity,
      unitPrice,
    });
  });

  const updatedBasket = await getBasketWithItems(basketId);
  if (!updatedBasket) {
    throw new HttpError(500, "Could not load basket after add", "BASKET_LOAD_FAILED");
  }

  return toBasketResponse(updatedBasket);
};

export const addBasketServiceTemplate = async (
  basketId: string,
  input: AddBasketServiceTemplateInput,
) => {
  validateBasketId(basketId);
  const templateId = input.templateId;
  if (!templateId || !isUuid(templateId)) {
    throw new HttpError(400, "templateId must be a valid UUID", "INVALID_WORKSHOP_SERVICE_TEMPLATE_ID");
  }

  await prisma.$transaction(async (tx) => {
    const basket = await tx.basket.findUnique({ where: { id: basketId } });
    if (!basket) {
      throw new HttpError(404, "Basket not found", "BASKET_NOT_FOUND");
    }
    assertOpenBasket(basket);

    const template = await tx.workshopServiceTemplate.findUnique({
      where: { id: templateId },
      include: {
        lines: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            variant: {
              select: {
                id: true,
                retailPricePence: true,
              },
            },
          },
        },
      },
    });

    if (!template || !template.isActive) {
      throw new HttpError(
        404,
        "Workshop service template not found",
        "WORKSHOP_SERVICE_TEMPLATE_NOT_FOUND",
      );
    }

    const linesToApply = template.lines.filter((line) => !line.isOptional);
    if (linesToApply.length === 0) {
      throw new HttpError(
        400,
        "Quick-add service templates need at least one required line",
        "WORKSHOP_SERVICE_TEMPLATE_EMPTY",
      );
    }

    let labourVariant: Awaited<ReturnType<typeof getOrCreateTemplateLabourVariantTx>> | null = null;

    for (const line of linesToApply) {
      if (line.type === "LABOUR" && !labourVariant) {
        labourVariant = await getOrCreateTemplateLabourVariantTx(tx, template);
      }
      const variantId = line.type === "LABOUR" ? labourVariant?.id : line.variantId;
      if (!variantId) {
        throw new HttpError(
          409,
          "Service template part lines must be linked to inventory before they can be used on POS",
          "WORKSHOP_SERVICE_TEMPLATE_PART_NOT_LINKED",
        );
      }

      await upsertBasketLineTx(tx, {
        basketId,
        variantId,
        quantity: line.qty,
        unitPrice: line.unitPricePence ?? line.variant?.retailPricePence ?? 0,
      });
    }
  });

  const updatedBasket = await getBasketWithItems(basketId);
  if (!updatedBasket) {
    throw new HttpError(500, "Could not load basket after template add", "BASKET_LOAD_FAILED");
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
