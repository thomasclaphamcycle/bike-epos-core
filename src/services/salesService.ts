import { BasketStatus, PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";

type CheckoutPaymentInput = {
  paymentMethod?: PaymentMethod;
  amountPence?: number;
  providerRef?: string;
};

type SaleReturnItemInput = {
  saleItemId: string;
  quantity: number;
};

type SaleReturnRefundInput = {
  method?: PaymentMethod;
  amountPence?: number;
  providerRef?: string;
};

type DateRangeInput = {
  from?: string;
  to?: string;
};

const toDateOrThrow = (value: string, label: "from" | "to"): Date => {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateOnly.test(value)) {
    throw new HttpError(400, `${label} must be YYYY-MM-DD`, "INVALID_DATE");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${label} is invalid`, "INVALID_DATE");
  }

  return date;
};

const getOrCreateDefaultStockLocationTx = async (tx: Prisma.TransactionClient) => {
  const existingDefault = await tx.stockLocation.findFirst({
    where: { isDefault: true },
    orderBy: { createdAt: "asc" },
  });

  if (existingDefault) {
    return existingDefault;
  }

  return tx.stockLocation.create({
    data: {
      name: "Default",
      isDefault: true,
    },
  });
};

const toSaleResponse = async (saleId: string) => {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      customer: true,
      items: {
        include: {
          variant: {
            include: {
              product: true,
            },
          },
        },
      },
      payments: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!sale) {
    throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
  }

  const primaryPayment = sale.payments[0] ?? null;

  return {
    sale: {
      id: sale.id,
      basketId: sale.basketId,
      subtotalPence: sale.subtotalPence,
      taxPence: sale.taxPence,
      totalPence: sale.totalPence,
      createdAt: sale.createdAt,
      customer: sale.customer
        ? {
            id: sale.customer.id,
            firstName: sale.customer.firstName,
            lastName: sale.customer.lastName,
            email: sale.customer.email,
            phone: sale.customer.phone,
          }
        : null,
    },
    saleItems: sale.items.map((item) => ({
      id: item.id,
      saleId: item.saleId,
      variantId: item.variantId,
      sku: item.variant.sku,
      productName: item.variant.product.name,
      variantName: item.variant.name,
      quantity: item.quantity,
      unitPricePence: item.unitPricePence,
      lineTotalPence: item.lineTotalPence,
    })),
    payment: primaryPayment
      ? {
          id: primaryPayment.id,
          saleId: primaryPayment.saleId,
          method: primaryPayment.method,
          amountPence: primaryPayment.amountPence,
          providerRef: primaryPayment.providerRef,
          createdAt: primaryPayment.createdAt,
        }
      : null,
  };
};

const validateCheckoutPayment = (
  payment: CheckoutPaymentInput,
  totalPence: number,
): { method: PaymentMethod; amountPence: number; providerRef?: string } | null => {
  const hasMethod = payment.paymentMethod !== undefined;
  const hasAmount = payment.amountPence !== undefined;

  if (!hasMethod && !hasAmount && payment.providerRef === undefined) {
    return null;
  }

  if (!hasMethod || !hasAmount) {
    throw new HttpError(
      400,
      "paymentMethod and amountPence are both required when payment is provided",
      "INVALID_PAYMENT",
    );
  }

  if (!Number.isInteger(payment.amountPence) || payment.amountPence <= 0) {
    throw new HttpError(400, "amountPence must be a positive integer", "INVALID_PAYMENT");
  }

  if (payment.amountPence !== totalPence) {
    throw new HttpError(400, "Payment amount must match basket total", "PAYMENT_MISMATCH");
  }

  return {
    method: payment.paymentMethod,
    amountPence: payment.amountPence,
    providerRef: payment.providerRef,
  };
};

const validateReturnRefund = (
  refund: SaleReturnRefundInput,
  returnTotalPence: number,
): { method: PaymentMethod; amountPence: number; providerRef?: string } | null => {
  const hasMethod = refund.method !== undefined;
  const hasAmount = refund.amountPence !== undefined;

  if (!hasMethod && !hasAmount && refund.providerRef === undefined) {
    return null;
  }

  if (!hasMethod || !hasAmount) {
    throw new HttpError(
      400,
      "refund.method and refund.amountPence are both required when refund is provided",
      "INVALID_REFUND",
    );
  }

  if (!Number.isInteger(refund.amountPence) || refund.amountPence <= 0) {
    throw new HttpError(400, "refund.amountPence must be a positive integer", "INVALID_REFUND");
  }

  if (refund.amountPence !== returnTotalPence) {
    throw new HttpError(
      400,
      "Refund amount must match returned items total",
      "RETURN_PAYMENT_MISMATCH",
    );
  }

  return {
    method: refund.method,
    amountPence: refund.amountPence,
    providerRef: refund.providerRef,
  };
};

export const checkoutBasketToSale = async (
  basketId: string,
  paymentInput: CheckoutPaymentInput,
) => {
  if (!isUuid(basketId)) {
    throw new HttpError(400, "Invalid basket id", "INVALID_BASKET_ID");
  }

  const txResult = await prisma.$transaction(async (tx) => {
    const existingSale = await tx.sale.findUnique({ where: { basketId } });
    if (existingSale) {
      return { saleId: existingSale.id, created: false };
    }

    const basket = await tx.basket.findUnique({
      where: { id: basketId },
      include: {
        items: true,
      },
    });

    if (!basket) {
      throw new HttpError(404, "Basket not found", "BASKET_NOT_FOUND");
    }

    if (basket.status !== BasketStatus.OPEN) {
      throw new HttpError(409, "Basket is not open", "BASKET_NOT_OPEN");
    }

    if (basket.items.length === 0) {
      throw new HttpError(400, "Cannot checkout an empty basket", "EMPTY_BASKET");
    }

    const subtotalPence = basket.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );
    const taxPence = 0;
    const totalPence = subtotalPence + taxPence;

    const payment = validateCheckoutPayment(paymentInput, totalPence);

    const sale = await tx.sale.create({
      data: {
        basketId: basket.id,
        subtotalPence,
        taxPence,
        totalPence,
      },
    });

    const defaultLocation = await getOrCreateDefaultStockLocationTx(tx);

    for (const item of basket.items) {
      const saleItem = await tx.saleItem.create({
        data: {
          saleId: sale.id,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPricePence: item.unitPrice,
          lineTotalPence: item.quantity * item.unitPrice,
        },
      });

      await tx.stockLedgerEntry.create({
        data: {
          variantId: item.variantId,
          locationId: defaultLocation.id,
          type: "SALE",
          quantityDelta: -item.quantity,
          referenceType: "SALE_ITEM",
          referenceId: saleItem.id,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          variantId: item.variantId,
          type: "SALE",
          quantity: -item.quantity,
          referenceType: "SALE_ITEM",
          referenceId: saleItem.id,
        },
      });
    }

    if (payment) {
      await tx.payment.create({
        data: {
          saleId: sale.id,
          method: payment.method,
          amountPence: payment.amountPence,
          providerRef: payment.providerRef,
        },
      });
    }

    await tx.basket.update({
      where: { id: basket.id },
      data: { status: BasketStatus.CHECKED_OUT },
    });

    return { saleId: sale.id, created: true };
  });

  const response = await toSaleResponse(txResult.saleId);
  return {
    ...response,
    idempotent: !txResult.created,
  };
};

export const createSaleReturn = async (
  saleId: string,
  items: SaleReturnItemInput[],
  refundInput: SaleReturnRefundInput,
) => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, "items must be a non-empty array", "INVALID_RETURN_ITEMS");
  }

  const seenSaleItems = new Set<string>();
  for (const item of items) {
    if (!isUuid(item.saleItemId)) {
      throw new HttpError(400, "Invalid saleItemId", "INVALID_SALE_ITEM_ID");
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new HttpError(400, "quantity must be a positive integer", "INVALID_RETURN_QUANTITY");
    }
    if (seenSaleItems.has(item.saleItemId)) {
      throw new HttpError(
        400,
        "saleItemId must be unique within a return request",
        "DUPLICATE_RETURN_ITEM",
      );
    }
    seenSaleItems.add(item.saleItemId);
  }

  const txResult = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      include: {
        items: true,
      },
    });

    if (!sale) {
      throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
    }

    const requestedSaleItemIds = items.map((item) => item.saleItemId);
    const saleItemById = new Map(sale.items.map((item) => [item.id, item]));

    for (const saleItemId of requestedSaleItemIds) {
      if (!saleItemById.has(saleItemId)) {
        throw new HttpError(
          400,
          "Each saleItemId must belong to the specified sale",
          "INVALID_RETURN_ITEM",
        );
      }
    }

    const returnedQtyBySaleItem = new Map<string, number>();
    const returnedAggregates = await tx.saleReturnItem.groupBy({
      by: ["saleItemId"],
      where: {
        saleItemId: {
          in: requestedSaleItemIds,
        },
      },
      _sum: {
        quantity: true,
      },
    });

    for (const entry of returnedAggregates) {
      returnedQtyBySaleItem.set(entry.saleItemId, entry._sum.quantity ?? 0);
    }

    const computedItems = items.map((item) => {
      const saleItem = saleItemById.get(item.saleItemId)!;
      const alreadyReturned = returnedQtyBySaleItem.get(item.saleItemId) ?? 0;
      const maxReturnable = saleItem.quantity - alreadyReturned;

      if (item.quantity > maxReturnable) {
        throw new HttpError(
          409,
          "Return quantity exceeds remaining returnable quantity",
          "RETURN_QUANTITY_EXCEEDED",
        );
      }

      return {
        saleItemId: item.saleItemId,
        variantId: saleItem.variantId,
        quantity: item.quantity,
        unitPricePence: saleItem.unitPricePence,
        lineTotalPence: item.quantity * saleItem.unitPricePence,
      };
    });

    const returnTotalPence = computedItems.reduce(
      (sum, item) => sum + item.lineTotalPence,
      0,
    );

    const refund = validateReturnRefund(refundInput, returnTotalPence);

    const saleReturn = await tx.saleReturn.create({
      data: {
        saleId,
      },
    });

    const createdReturnItems: Array<{
      id: string;
      returnId: string;
      saleItemId: string;
      quantity: number;
      unitPricePence: number;
      lineTotalPence: number;
      createdAt: Date;
    }> = [];
    const defaultLocation = await getOrCreateDefaultStockLocationTx(tx);

    for (const item of computedItems) {
      const returnItem = await tx.saleReturnItem.create({
        data: {
          returnId: saleReturn.id,
          saleItemId: item.saleItemId,
          quantity: item.quantity,
          unitPricePence: item.unitPricePence,
          lineTotalPence: item.lineTotalPence,
        },
      });
      createdReturnItems.push(returnItem);

      await tx.stockLedgerEntry.create({
        data: {
          variantId: item.variantId,
          locationId: defaultLocation.id,
          type: "RETURN",
          quantityDelta: item.quantity,
          referenceType: "SALE_RETURN_ITEM",
          referenceId: returnItem.id,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          variantId: item.variantId,
          type: "RETURN",
          quantity: item.quantity,
          referenceType: "SALE_RETURN_ITEM",
          referenceId: returnItem.id,
        },
      });
    }

    let refundPayment: {
      id: string;
      saleId: string;
      method: PaymentMethod;
      amountPence: number;
      providerRef: string | null;
      createdAt: Date;
    } | null = null;

    if (refund) {
      refundPayment = await tx.payment.create({
        data: {
          saleId,
          method: refund.method,
          amountPence: -refund.amountPence,
          providerRef: refund.providerRef,
        },
      });
    }

    return {
      saleReturn,
      returnItems: createdReturnItems,
      refundPayment,
      returnTotalPence,
    };
  });

  return {
    return: {
      id: txResult.saleReturn.id,
      saleId: txResult.saleReturn.saleId,
      createdAt: txResult.saleReturn.createdAt,
      totalPence: txResult.returnTotalPence,
    },
    returnItems: txResult.returnItems.map((item) => ({
      id: item.id,
      returnId: item.returnId,
      saleItemId: item.saleItemId,
      quantity: item.quantity,
      unitPricePence: item.unitPricePence,
      lineTotalPence: item.lineTotalPence,
      createdAt: item.createdAt,
    })),
    refundPayment: txResult.refundPayment
      ? {
          id: txResult.refundPayment.id,
          saleId: txResult.refundPayment.saleId,
          method: txResult.refundPayment.method,
          amountPence: txResult.refundPayment.amountPence,
          providerRef: txResult.refundPayment.providerRef,
          createdAt: txResult.refundPayment.createdAt,
        }
      : null,
  };
};

export const getSaleById = async (saleId: string) => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }

  return toSaleResponse(saleId);
};

export const attachCustomerToSale = async (
  saleId: string,
  customerId: string | null,
) => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }

  if (customerId !== null && !isUuid(customerId)) {
    throw new HttpError(400, "Invalid customer id", "INVALID_CUSTOMER_ID");
  }

  await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({ where: { id: saleId } });
    if (!sale) {
      throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
    }

    if (customerId !== null) {
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
      });
      if (!customer) {
        throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
      }
    }

    await tx.sale.update({
      where: { id: saleId },
      data: { customerId },
    });
  });

  return toSaleResponse(saleId);
};

export const listSales = async ({ from, to }: DateRangeInput) => {
  const createdAt: Prisma.DateTimeFilter = {};

  if (from) {
    createdAt.gte = toDateOrThrow(from, "from");
  }

  if (to) {
    const toDate = toDateOrThrow(to, "to");
    toDate.setUTCDate(toDate.getUTCDate() + 1);
    createdAt.lt = toDate;
  }

  const where: Prisma.SaleWhereInput = {};
  if (Object.keys(createdAt).length > 0) {
    where.createdAt = createdAt;
  }

  const sales = await prisma.sale.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      payments: {
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  return {
    sales: sales.map((sale) => ({
      id: sale.id,
      basketId: sale.basketId,
      subtotalPence: sale.subtotalPence,
      taxPence: sale.taxPence,
      totalPence: sale.totalPence,
      createdAt: sale.createdAt,
      payment: sale.payments[0]
        ? {
            method: sale.payments[0].method,
            amountPence: sale.payments[0].amountPence,
          }
        : null,
    })),
  };
};
