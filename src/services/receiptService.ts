import { PaymentMethod, Prisma, SaleTenderMethod } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

const paymentMethodToTenderMethod = (method: PaymentMethod): SaleTenderMethod => {
  switch (method) {
    case "CASH":
      return "CASH";
    case "CARD":
      return "CARD";
    default:
      return "VOUCHER";
  }
};

const providerToTenderMethod = (provider: string): SaleTenderMethod => {
  const normalized = normalizeOptionalText(provider)?.toUpperCase();
  if (normalized === "CASH") {
    return "CASH";
  }
  if (normalized === "CARD") {
    return "CARD";
  }
  return "CARD";
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

const getOrCreateReceiptSettingsTx = async (tx: Prisma.TransactionClient) =>
  tx.receiptSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      shopName: "Bike EPOS",
      shopAddress: "123 Service Lane",
      footerText: "Thank you for your custom.",
    },
    update: {},
  });

const getNextReceiptNumberTx = async (tx: Prisma.TransactionClient) => {
  await tx.receiptCounter.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      nextValue: 0,
    },
    update: {},
  });

  const next = await tx.receiptCounter.update({
    where: { id: 1 },
    data: {
      nextValue: {
        increment: 1,
      },
    },
    select: {
      nextValue: true,
    },
  });

  return `R-${String(next.nextValue).padStart(8, "0")}`;
};

const toIssuedReceiptEnvelope = (receipt: {
  id: string;
  receiptNumber: string;
  saleId: string | null;
  refundId: string | null;
  issuedAt: Date;
}) => ({
  id: receipt.id,
  receiptNumber: receipt.receiptNumber,
  saleId: receipt.saleId,
  refundId: receipt.refundId,
  issuedAt: receipt.issuedAt,
});

type IssueReceiptInput = {
  saleId?: string;
  refundId?: string;
  issuedByStaffId?: string;
};

export const issueReceipt = async (input: IssueReceiptInput) => {
  const saleId = normalizeOptionalText(input.saleId);
  const refundId = normalizeOptionalText(input.refundId);
  const issuedByStaffId = normalizeOptionalText(input.issuedByStaffId);

  const hasSale = Boolean(saleId);
  const hasRefund = Boolean(refundId);

  if (hasSale === hasRefund) {
    throw new HttpError(400, "Provide exactly one of saleId or refundId", "INVALID_RECEIPT_ISSUE");
  }

  if (saleId && !isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }
  if (refundId && !isUuid(refundId)) {
    throw new HttpError(400, "Invalid refund id", "INVALID_REFUND_ID");
  }

  return prisma.$transaction(async (tx) => {
    if (saleId) {
      const existing = await tx.receipt.findUnique({
        where: { saleId },
        select: {
          id: true,
          receiptNumber: true,
          saleId: true,
          refundId: true,
          issuedAt: true,
        },
      });
      if (existing) {
        return {
          receipt: toIssuedReceiptEnvelope(existing),
          idempotent: true,
        };
      }

      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        select: {
          id: true,
          completedAt: true,
        },
      });

      if (!sale) {
        throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
      }
      if (!sale.completedAt) {
        throw new HttpError(409, "Sale must be completed before issuing receipt", "SALE_NOT_COMPLETED");
      }

      const settings = await getOrCreateReceiptSettingsTx(tx);
      const receiptNumber = await getNextReceiptNumberTx(tx);
      const created = await tx.receipt.create({
        data: {
          saleId,
          receiptNumber,
          issuedByStaffId: issuedByStaffId ?? null,
          shopName: settings.shopName,
          shopAddress: settings.shopAddress,
          vatNumber: settings.vatNumber,
          footerText: settings.footerText,
        },
        select: {
          id: true,
          receiptNumber: true,
          saleId: true,
          refundId: true,
          issuedAt: true,
        },
      });

      await tx.sale.update({
        where: { id: saleId },
        data: { receiptNumber },
      });

      return {
        receipt: toIssuedReceiptEnvelope(created),
        idempotent: false,
      };
    }

    const existing = await tx.receipt.findUnique({
      where: { refundId: refundId! },
      select: {
        id: true,
        receiptNumber: true,
        saleId: true,
        refundId: true,
        issuedAt: true,
      },
    });
    if (existing) {
      return {
        receipt: toIssuedReceiptEnvelope(existing),
        idempotent: true,
      };
    }

    const refund = await tx.paymentRefund.findUnique({
      where: { id: refundId! },
      select: { id: true },
    });
    if (!refund) {
      throw new HttpError(404, "Refund not found", "REFUND_NOT_FOUND");
    }

    const settings = await getOrCreateReceiptSettingsTx(tx);
    const receiptNumber = await getNextReceiptNumberTx(tx);
    const created = await tx.receipt.create({
      data: {
        refundId: refund.id,
        receiptNumber,
        issuedByStaffId: issuedByStaffId ?? null,
        shopName: settings.shopName,
        shopAddress: settings.shopAddress,
        vatNumber: settings.vatNumber,
        footerText: settings.footerText,
      },
      select: {
        id: true,
        receiptNumber: true,
        saleId: true,
        refundId: true,
        issuedAt: true,
      },
    });

    return {
      receipt: toIssuedReceiptEnvelope(created),
      idempotent: false,
    };
  });
};

export type DetailedReceipt = {
  receiptNumber: string;
  issuedAt: Date;
  saleId: string | null;
  refundId: string | null;
  type: "SALE" | "REFUND";
  shop: {
    name: string;
    address: string;
    vatNumber: string | null;
    footerText: string | null;
  };
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
  createdAt: Date;
  completedAt: Date | null;
  items: Array<{
    variantId: string | null;
    sku: string | null;
    name: string;
    qty: number;
    unitPricePence: number;
    lineTotalPence: number;
  }>;
  totals: {
    subtotalPence: number;
    taxPence: number;
    totalPence: number;
    changeDuePence: number;
  };
  tenders: Array<{
    id: string;
    method: SaleTenderMethod;
    amountPence: number;
    createdAt: Date;
  }>;
  payments: Array<{
    id: string;
    method: PaymentMethod;
    amountPence: number;
    status: string;
    providerRef: string | null;
    createdAt: Date;
  }>;
  refund: {
    id: string;
    amountPence: number;
    reason: string;
    status: string;
    paymentId: string;
    method: PaymentMethod;
    saleId: string | null;
  } | null;
};

const buildDetailedSaleReceipt = (receipt: {
  receiptNumber: string;
  saleId: string | null;
  refundId: string | null;
  issuedAt: Date;
  shopName: string;
  shopAddress: string;
  vatNumber: string | null;
  footerText: string | null;
  issuedByStaffId: string | null;
  issuedByStaff: {
    id: string;
    name: string | null;
    username: string;
  } | null;
  sale: {
    id: string;
    createdAt: Date;
    completedAt: Date | null;
    subtotalPence: number;
    taxPence: number;
    totalPence: number;
    changeDuePence: number;
    customer: {
      id: string;
      name: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
    } | null;
    items: Array<{
      variantId: string;
      quantity: number;
      unitPricePence: number;
      lineTotalPence: number;
      variant: {
        sku: string;
        name: string | null;
        option: string | null;
        product: {
          name: string;
        };
      };
    }>;
    tenders: Array<{
      id: string;
      method: SaleTenderMethod;
      amountPence: number;
      createdAt: Date;
    }>;
    paymentIntents: Array<{
      id: string;
      provider: string;
      status: string;
      amountPence: number;
      updatedAt: Date;
    }>;
    payments: Array<{
      id: string;
      method: PaymentMethod;
      amountPence: number;
      providerRef: string | null;
      createdAt: Date;
      status: string;
    }>;
    createdByStaffId: string | null;
    createdByStaff: {
      id: string;
      username: string;
      name: string | null;
    } | null;
  };
}): DetailedReceipt => {
  const items = receipt.sale.items.map((item) => {
    const baseName = item.variant.product.name;
    const variantName = normalizeOptionalText(item.variant.name ?? item.variant.option ?? undefined);

    return {
      variantId: item.variantId,
      sku: item.variant.sku,
      name: variantName ? `${baseName} - ${variantName}` : baseName,
      qty: item.quantity,
      unitPricePence: item.unitPricePence,
      lineTotalPence: item.lineTotalPence,
    };
  });

  const fallbackTendersFromIntents = receipt.sale.paymentIntents
    .filter((intent) => intent.status === "CAPTURED" && intent.amountPence > 0)
    .map((intent) => ({
      id: `intent:${intent.id}`,
      method: providerToTenderMethod(intent.provider),
      amountPence: intent.amountPence,
      createdAt: intent.updatedAt,
    }));

  const fallbackTendersFromPayments = receipt.sale.payments
    .filter((payment) => payment.amountPence > 0)
    .map((payment) => ({
      id: `payment:${payment.id}`,
      method: paymentMethodToTenderMethod(payment.method),
      amountPence: payment.amountPence,
      createdAt: payment.createdAt,
    }));

  const tenders =
    receipt.sale.tenders.length > 0
      ? receipt.sale.tenders
      : fallbackTendersFromIntents.length > 0
        ? fallbackTendersFromIntents
        : fallbackTendersFromPayments;

  return {
    receiptNumber: receipt.receiptNumber,
    issuedAt: receipt.issuedAt,
    saleId: receipt.saleId,
    refundId: receipt.refundId,
    type: "SALE",
    shop: {
      name: receipt.shopName,
      address: receipt.shopAddress,
      vatNumber: receipt.vatNumber,
      footerText: receipt.footerText,
    },
    staff: {
      id:
        receipt.issuedByStaff?.id ??
        receipt.issuedByStaffId ??
        receipt.sale.createdByStaff?.id ??
        receipt.sale.createdByStaffId,
      name:
        receipt.issuedByStaff?.name ??
        receipt.issuedByStaff?.username ??
        receipt.sale.createdByStaff?.name ??
        receipt.sale.createdByStaff?.username ??
        null,
    },
    customer: receipt.sale.customer
      ? {
          id: receipt.sale.customer.id,
          name: toCustomerName(receipt.sale.customer),
          email: receipt.sale.customer.email,
          phone: receipt.sale.customer.phone,
        }
      : null,
    createdAt: receipt.sale.createdAt,
    completedAt: receipt.sale.completedAt,
    items,
    totals: {
      subtotalPence: receipt.sale.subtotalPence,
      taxPence: receipt.sale.taxPence,
      totalPence: receipt.sale.totalPence,
      changeDuePence: receipt.sale.changeDuePence,
    },
    tenders,
    payments: receipt.sale.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amountPence: payment.amountPence,
      status: payment.status,
      providerRef: payment.providerRef,
      createdAt: payment.createdAt,
    })),
    refund: null,
  };
};

const buildDetailedRefundReceipt = (receipt: {
  receiptNumber: string;
  saleId: string | null;
  refundId: string | null;
  issuedAt: Date;
  shopName: string;
  shopAddress: string;
  vatNumber: string | null;
  footerText: string | null;
  issuedByStaffId: string | null;
  issuedByStaff: {
    id: string;
    name: string | null;
    username: string;
  } | null;
  refund: {
    id: string;
    amountPence: number;
    reason: string;
    status: string;
    paymentId: string;
    createdAt: Date;
    payment: {
      method: PaymentMethod;
      saleId: string | null;
      sale: {
        createdAt: Date;
        completedAt: Date | null;
        customer: {
          id: string;
          name: string;
          firstName: string;
          lastName: string;
          email: string | null;
          phone: string | null;
        } | null;
      } | null;
    };
  };
}): DetailedReceipt => {
  const refund = receipt.refund;

  return {
    receiptNumber: receipt.receiptNumber,
    issuedAt: receipt.issuedAt,
    saleId: receipt.saleId,
    refundId: receipt.refundId,
    type: "REFUND",
    shop: {
      name: receipt.shopName,
      address: receipt.shopAddress,
      vatNumber: receipt.vatNumber,
      footerText: receipt.footerText,
    },
    staff: {
      id: receipt.issuedByStaff?.id ?? receipt.issuedByStaffId,
      name: receipt.issuedByStaff?.name ?? receipt.issuedByStaff?.username ?? null,
    },
    customer: refund.payment.sale?.customer
      ? {
          id: refund.payment.sale.customer.id,
          name: toCustomerName(refund.payment.sale.customer),
          email: refund.payment.sale.customer.email,
          phone: refund.payment.sale.customer.phone,
        }
      : null,
    createdAt: refund.payment.sale?.createdAt ?? refund.createdAt,
    completedAt: refund.payment.sale?.completedAt ?? null,
    items: [
      {
        variantId: null,
        sku: null,
        name: `Refund ${refund.id}`,
        qty: 1,
        unitPricePence: refund.amountPence,
        lineTotalPence: refund.amountPence,
      },
    ],
    totals: {
      subtotalPence: refund.amountPence,
      taxPence: 0,
      totalPence: refund.amountPence,
      changeDuePence: 0,
    },
    tenders: [
      {
        id: `refund:${refund.id}`,
        method: paymentMethodToTenderMethod(refund.payment.method),
        amountPence: refund.amountPence,
        createdAt: refund.createdAt,
      },
    ],
    payments: [
      {
        id: refund.paymentId,
        method: refund.payment.method,
        amountPence: -refund.amountPence,
        status: refund.status,
        providerRef: null,
        createdAt: refund.createdAt,
      },
    ],
    refund: {
      id: refund.id,
      amountPence: refund.amountPence,
      reason: refund.reason,
      status: refund.status,
      paymentId: refund.paymentId,
      method: refund.payment.method,
      saleId: refund.payment.saleId,
    },
  };
};

export const getReceiptByNumber = async (receiptNumber: string): Promise<DetailedReceipt> => {
  const normalized = normalizeOptionalText(receiptNumber);
  if (!normalized) {
    throw new HttpError(400, "Invalid receipt number", "INVALID_RECEIPT_NUMBER");
  }

  const receipt = await prisma.receipt.findUnique({
    where: { receiptNumber: normalized },
    include: {
      issuedByStaff: {
        select: {
          id: true,
          username: true,
          name: true,
        },
      },
      sale: {
        include: {
          customer: true,
          createdByStaff: {
            select: {
              id: true,
              username: true,
              name: true,
            },
          },
          items: {
            orderBy: [{ id: "asc" }],
            include: {
              variant: {
                include: {
                  product: true,
                },
              },
            },
          },
          tenders: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          },
          paymentIntents: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          },
          payments: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          },
        },
      },
      refund: {
        include: {
          payment: {
            include: {
              sale: {
                include: {
                  customer: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!receipt) {
    throw new HttpError(404, "Receipt not found", "RECEIPT_NOT_FOUND");
  }

  if (receipt.sale) {
    return buildDetailedSaleReceipt(receipt as Parameters<typeof buildDetailedSaleReceipt>[0]);
  }

  if (receipt.refund) {
    return buildDetailedRefundReceipt(receipt as Parameters<typeof buildDetailedRefundReceipt>[0]);
  }

  throw new HttpError(409, "Receipt is not linked to a sale or refund", "INVALID_RECEIPT");
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

  const issued = await issueReceipt({ saleId });

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
    receiptNumber: issued.receipt.receiptNumber,
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
