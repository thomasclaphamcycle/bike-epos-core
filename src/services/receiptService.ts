import { PaymentMethod } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toReceiptNumber = (saleId: string, timestamp: Date) => {
  const y = timestamp.getUTCFullYear();
  const m = String(timestamp.getUTCMonth() + 1).padStart(2, "0");
  const d = String(timestamp.getUTCDate()).padStart(2, "0");
  const normalizedSaleId = saleId.replaceAll("-", "").toUpperCase();
  return `S-${y}${m}${d}-${normalizedSaleId}`;
};

const toCustomerName = (customer: {
  name?: string | null;
  firstName: string;
  lastName: string;
}) => {
  const explicitName = normalizeOptionalText(customer.name ?? undefined);
  if (explicitName) {
    return explicitName;
  }

  return [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
};

const toMethodForProvider = (provider: string): PaymentMethod => {
  if (provider === "CASH") {
    return "CASH";
  }
  if (provider === "CARD") {
    return "CARD";
  }
  return "OTHER";
};

export type SaleReceipt = {
  saleId: string;
  receiptNumber: string;
  completedAt: Date | null;
  createdAt: Date;
  staff: {
    id: string | null;
    name: string | null;
  };
  customer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  items: Array<{
    variantId: string;
    sku: string;
    name: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  totals: {
    subtotal: number;
    tax: number;
    total: number;
  };
  payments: Array<{
    intentId: string;
    provider: string;
    method: PaymentMethod;
    status: string;
    amount: number;
    capturedAt: Date | null;
  }>;
};

export const getSaleReceiptById = async (saleId: string): Promise<SaleReceipt> => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      customer: true,
      createdByStaff: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
      items: {
        orderBy: { id: "asc" },
        include: {
          variant: {
            include: {
              product: true,
            },
          },
        },
      },
      paymentIntents: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
      payments: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });

  if (!sale) {
    throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
  }

  const receiptNumber =
    sale.receiptNumber ?? toReceiptNumber(sale.id, sale.completedAt ?? sale.createdAt);

  const items = sale.items.map((item) => {
    const baseName = item.variant.product.name;
    const variantName = normalizeOptionalText(item.variant.name ?? item.variant.option ?? undefined);

    return {
      variantId: item.variantId,
      sku: item.variant.sku,
      name: variantName ? `${baseName} - ${variantName}` : baseName,
      qty: item.quantity,
      unitPrice: item.unitPricePence,
      lineTotal: item.lineTotalPence,
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const tax = sale.taxPence ?? 0;
  const total = subtotal + tax;

  const paymentsFromIntents = sale.paymentIntents.map((intent) => ({
    intentId: intent.id,
    provider: intent.provider,
    method: toMethodForProvider(intent.provider),
    status: intent.status,
    amount: intent.amountPence,
    capturedAt: intent.status === "CAPTURED" ? intent.updatedAt : null,
  }));

  const intentIds = new Set(sale.paymentIntents.map((intent) => intent.id));
  const legacyPayments = sale.payments
    .filter((payment) => {
      const providerRef = normalizeOptionalText(payment.providerRef ?? undefined);
      if (!providerRef || !providerRef.startsWith("intent:")) {
        return true;
      }
      const linkedIntentId = providerRef.slice("intent:".length);
      return !intentIds.has(linkedIntentId);
    })
    .map((payment) => ({
      intentId: `payment:${payment.id}`,
      provider: payment.method,
      method: payment.method,
      status: payment.amountPence >= 0 ? "CAPTURED" : "REFUNDED",
      amount: payment.amountPence,
      capturedAt: payment.createdAt,
    }));

  return {
    saleId: sale.id,
    receiptNumber,
    completedAt: sale.completedAt,
    createdAt: sale.createdAt,
    staff: {
      id: sale.createdByStaff?.id ?? sale.createdByStaffId ?? null,
      name: sale.createdByStaff?.name ?? sale.createdByStaff?.username ?? null,
    },
    customer: sale.customer
      ? {
          id: sale.customer.id,
          name: toCustomerName(sale.customer),
          email: sale.customer.email,
          phone: sale.customer.phone,
        }
      : null,
    items,
    totals: {
      subtotal,
      tax,
      total,
    },
    payments: [...paymentsFromIntents, ...legacyPayments],
  };
};
