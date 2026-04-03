import { PaymentMethod, Prisma, RefundTenderType, SaleTenderMethod } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { getCustomerDisplayName } from "../utils/customerName";
import {
  buildLegacyReceiptSettingsFromStore,
  listShopSettings,
  listStoreInfoSettings,
  type StoreInfoSettings,
} from "./configurationService";

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toCustomerName = (customer: { firstName: string; lastName: string }) =>
  getCustomerDisplayName(customer, "");

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

const refundTenderTypeToTenderMethod = (tenderType: RefundTenderType): SaleTenderMethod => {
  switch (tenderType) {
    case "CASH":
      return "CASH";
    case "CARD":
      return "CARD";
    case "VOUCHER":
      return "VOUCHER";
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

const refundTenderTypeToPaymentMethod = (tenderType: RefundTenderType): PaymentMethod => {
  if (tenderType === "CASH") {
    return "CASH";
  }
  if (tenderType === "CARD") {
    return "CARD";
  }
  return "OTHER";
};

const getOrCreateReceiptSettingsTx = async (tx: Prisma.TransactionClient) => {
  const settings = await listShopSettings(tx);
  const desiredSettings = buildLegacyReceiptSettingsFromStore(settings.store);
  const existing = await tx.receiptSettings.findUnique({
    where: { id: 1 },
  });

  if (!existing) {
    return tx.receiptSettings.create({
      data: {
        id: 1,
        ...desiredSettings,
      },
    });
  }

  if (
    existing.shopName === desiredSettings.shopName
    && existing.shopAddress === desiredSettings.shopAddress
    && existing.vatNumber === desiredSettings.vatNumber
    && existing.footerText === desiredSettings.footerText
  ) {
    return existing;
  }

  return tx.receiptSettings.update({
    where: { id: 1 },
    data: desiredSettings,
  });
};

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
  saleRefundId: string | null;
  issuedAt: Date;
}) => ({
  id: receipt.id,
  receiptNumber: receipt.receiptNumber,
  saleId: receipt.saleId,
  refundId: receipt.saleRefundId ?? receipt.refundId,
  paymentRefundId: receipt.refundId,
  saleRefundId: receipt.saleRefundId,
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
          saleRefundId: true,
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
          saleRefundId: true,
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

    const existingPaymentRefundReceipt = await tx.receipt.findUnique({
      where: { refundId: refundId! },
      select: {
        id: true,
        receiptNumber: true,
        saleId: true,
        refundId: true,
        saleRefundId: true,
        issuedAt: true,
      },
    });
    if (existingPaymentRefundReceipt) {
      return {
        receipt: toIssuedReceiptEnvelope(existingPaymentRefundReceipt),
        idempotent: true,
      };
    }

    const existingSaleRefundReceipt = await tx.receipt.findUnique({
      where: { saleRefundId: refundId! },
      select: {
        id: true,
        receiptNumber: true,
        saleId: true,
        refundId: true,
        saleRefundId: true,
        issuedAt: true,
      },
    });
    if (existingSaleRefundReceipt) {
      return {
        receipt: toIssuedReceiptEnvelope(existingSaleRefundReceipt),
        idempotent: true,
      };
    }

    const paymentRefund = await tx.paymentRefund.findUnique({
      where: { id: refundId! },
      select: { id: true },
    });
    if (paymentRefund) {
      const settings = await getOrCreateReceiptSettingsTx(tx);
      const receiptNumber = await getNextReceiptNumberTx(tx);
      const created = await tx.receipt.create({
        data: {
          refundId: paymentRefund.id,
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
          saleRefundId: true,
          issuedAt: true,
        },
      });

      return {
        receipt: toIssuedReceiptEnvelope(created),
        idempotent: false,
      };
    }

    const saleRefund = await tx.refund.findUnique({
      where: { id: refundId! },
      select: {
        id: true,
        status: true,
        completedAt: true,
      },
    });
    if (!saleRefund) {
      throw new HttpError(404, "Refund not found", "REFUND_NOT_FOUND");
    }
    if (saleRefund.status !== "COMPLETED" || !saleRefund.completedAt) {
      throw new HttpError(
        409,
        "Refund must be completed before issuing receipt",
        "REFUND_NOT_COMPLETED",
      );
    }

    const settings = await getOrCreateReceiptSettingsTx(tx);
    const receiptNumber = await getNextReceiptNumberTx(tx);
    const created = await tx.receipt.create({
      data: {
        saleRefundId: saleRefund.id,
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
          saleRefundId: true,
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
    logoUrl: string;
    uploadedLogoPath: string;
    preferredLogoUrl: string;
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
    reason: string | null;
    status: string;
    paymentId: string | null;
    method: string | null;
    saleId: string | null;
    kind: "PAYMENT_REFUND" | "SALE_REFUND";
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
      logoUrl: "",
      uploadedLogoPath: "",
      preferredLogoUrl: "",
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

const buildDetailedPaymentRefundReceipt = (receipt: {
  receiptNumber: string;
  saleId: string | null;
  refundId: string | null;
  saleRefundId: string | null;
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
    refundId: receipt.saleRefundId ?? receipt.refundId,
    type: "REFUND",
    shop: {
      name: receipt.shopName,
      address: receipt.shopAddress,
      vatNumber: receipt.vatNumber,
      logoUrl: "",
      uploadedLogoPath: "",
      preferredLogoUrl: "",
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
      kind: "PAYMENT_REFUND",
    },
  };
};

const buildDetailedSaleRefundReceipt = (receipt: {
  receiptNumber: string;
  saleId: string | null;
  refundId: string | null;
  saleRefundId: string | null;
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
  saleRefund: {
    id: string;
    saleId: string;
    status: string;
    currency: string;
    subtotalPence: number;
    taxPence: number;
    totalPence: number;
    createdAt: Date;
    completedAt: Date | null;
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
    };
    lines: Array<{
      id: string;
      saleLineId: string;
      quantity: number;
      unitPricePence: number;
      lineTotalPence: number;
      saleLine: {
        variantId: string;
        variant: {
          sku: string;
          name: string | null;
          option: string | null;
          product: {
            name: string;
          };
        };
      };
    }>;
    tenders: Array<{
      id: string;
      tenderType: RefundTenderType;
      amountPence: number;
      createdAt: Date;
    }>;
  };
}): DetailedReceipt => {
  const saleRefund = receipt.saleRefund;

  const items = saleRefund.lines.map((line) => {
    const baseName = line.saleLine.variant.product.name;
    const variantName = normalizeOptionalText(
      line.saleLine.variant.name ?? line.saleLine.variant.option ?? undefined,
    );

    return {
      variantId: line.saleLine.variantId,
      sku: line.saleLine.variant.sku,
      name: variantName ? `${baseName} - ${variantName}` : baseName,
      qty: line.quantity,
      unitPricePence: line.unitPricePence,
      lineTotalPence: line.lineTotalPence,
    };
  });

  const tenders = saleRefund.tenders.map((tender) => ({
    id: tender.id,
    method: refundTenderTypeToTenderMethod(tender.tenderType),
    amountPence: tender.amountPence,
    createdAt: tender.createdAt,
  }));

  return {
    receiptNumber: receipt.receiptNumber,
    issuedAt: receipt.issuedAt,
    saleId: saleRefund.saleId,
    refundId: receipt.saleRefundId ?? receipt.refundId,
    type: "REFUND",
    shop: {
      name: receipt.shopName,
      address: receipt.shopAddress,
      vatNumber: receipt.vatNumber,
      logoUrl: "",
      uploadedLogoPath: "",
      preferredLogoUrl: "",
      footerText: receipt.footerText,
    },
    staff: {
      id: receipt.issuedByStaff?.id ?? receipt.issuedByStaffId,
      name: receipt.issuedByStaff?.name ?? receipt.issuedByStaff?.username ?? null,
    },
    customer: saleRefund.sale.customer
      ? {
          id: saleRefund.sale.customer.id,
          name: toCustomerName(saleRefund.sale.customer),
          email: saleRefund.sale.customer.email,
          phone: saleRefund.sale.customer.phone,
        }
      : null,
    createdAt: saleRefund.createdAt,
    completedAt: saleRefund.completedAt ?? saleRefund.sale.completedAt,
    items,
    totals: {
      subtotalPence: saleRefund.subtotalPence,
      taxPence: saleRefund.taxPence,
      totalPence: saleRefund.totalPence,
      changeDuePence: 0,
    },
    tenders,
    payments: saleRefund.tenders.map((tender) => ({
      id: tender.id,
      method: refundTenderTypeToPaymentMethod(tender.tenderType),
      amountPence: -tender.amountPence,
      status: saleRefund.status,
      providerRef: null,
      createdAt: tender.createdAt,
    })),
    refund: {
      id: saleRefund.id,
      amountPence: saleRefund.totalPence,
      reason: null,
      status: saleRefund.status,
      paymentId: null,
      method: saleRefund.tenders[0]
        ? refundTenderTypeToPaymentMethod(saleRefund.tenders[0].tenderType)
        : null,
      saleId: saleRefund.saleId,
      kind: "SALE_REFUND",
    },
  };
};

const withResolvedStoreLogo = (
  receipt: DetailedReceipt,
  store: StoreInfoSettings,
): DetailedReceipt => ({
  ...receipt,
  shop: {
    ...receipt.shop,
    logoUrl: store.logoUrl,
    uploadedLogoPath: store.uploadedLogoPath,
    preferredLogoUrl: store.preferredLogoUrl,
  },
});

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
      saleRefund: {
        include: {
          sale: {
            include: {
              customer: true,
            },
          },
          lines: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            include: {
              saleLine: {
                include: {
                  variant: {
                    include: {
                      product: true,
                    },
                  },
                },
              },
            },
          },
          tenders: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          },
        },
      },
    },
  });

  if (!receipt) {
    throw new HttpError(404, "Receipt not found", "RECEIPT_NOT_FOUND");
  }

  const currentStoreInfo = await listStoreInfoSettings();

  if (receipt.sale) {
    return withResolvedStoreLogo(
      buildDetailedSaleReceipt(receipt as Parameters<typeof buildDetailedSaleReceipt>[0]),
      currentStoreInfo,
    );
  }

  if (receipt.refund) {
    return withResolvedStoreLogo(
      buildDetailedPaymentRefundReceipt(
        receipt as Parameters<typeof buildDetailedPaymentRefundReceipt>[0],
      ),
      currentStoreInfo,
    );
  }

  if (receipt.saleRefund) {
    return withResolvedStoreLogo(
      buildDetailedSaleRefundReceipt(
        receipt as Parameters<typeof buildDetailedSaleRefundReceipt>[0],
      ),
      currentStoreInfo,
    );
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
