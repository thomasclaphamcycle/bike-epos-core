import { LayawayStatus, PaymentMethod, Prisma, SaleTenderMethod } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { checkoutBasketToSale, completeSaleIfEligible } from "./salesService";
import { ensureDefaultStockLocationTx } from "./locationService";
import { recordCashSaleMovementForPaymentTx } from "./tillService";

const DEFAULT_LAYAWAY_EXPIRY_DAYS = 14;
const MAX_LAYAWAY_EXPIRY_DAYS = 90;

type CreateLayawayInput = {
  deposit?: {
    paymentMethod?: PaymentMethod;
    amountPence?: number;
    providerRef?: string;
  };
  expiryDays?: number;
  expiresAt?: string;
  notes?: string | null;
};

const normalizeOptionalText = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toSaleTenderMethodFromPaymentMethod = (method: PaymentMethod): SaleTenderMethod => {
  switch (method) {
    case "CASH":
      return "CASH";
    case "CARD":
      return "CARD";
    default:
      return "BANK_TRANSFER";
  }
};

const resolveExpiryDate = (input: CreateLayawayInput) => {
  if (input.expiresAt) {
    const parsed = new Date(input.expiresAt);
    if (Number.isNaN(parsed.getTime()) || parsed <= new Date()) {
      throw new HttpError(400, "expiresAt must be a future date", "INVALID_LAYAWAY_EXPIRY");
    }
    return parsed;
  }

  const expiryDays = input.expiryDays ?? DEFAULT_LAYAWAY_EXPIRY_DAYS;
  if (!Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > MAX_LAYAWAY_EXPIRY_DAYS) {
    throw new HttpError(
      400,
      `expiryDays must be between 1 and ${MAX_LAYAWAY_EXPIRY_DAYS}`,
      "INVALID_LAYAWAY_EXPIRY",
    );
  }

  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + expiryDays);
  return expiresAt;
};

const normalizeDeposit = (input: CreateLayawayInput["deposit"]) => {
  if (!input || input.amountPence === undefined) {
    return null;
  }
  if (!input.paymentMethod) {
    throw new HttpError(400, "deposit.paymentMethod is required with a deposit", "INVALID_LAYAWAY_DEPOSIT");
  }
  if (!Number.isInteger(input.amountPence) || input.amountPence <= 0) {
    throw new HttpError(400, "deposit.amountPence must be a positive integer", "INVALID_LAYAWAY_DEPOSIT");
  }

  return {
    paymentMethod: input.paymentMethod,
    amountPence: input.amountPence,
    providerRef: normalizeOptionalText(input.providerRef),
  };
};

const getPaidPenceTx = async (tx: Prisma.TransactionClient, saleId: string) => {
  const aggregate = await tx.payment.aggregate({
    where: {
      saleId,
      status: { not: "REFUNDED" },
      amountPence: { gt: 0 },
    },
    _sum: {
      amountPence: true,
      refundedTotalPence: true,
    },
  });
  return Math.max(0, (aggregate._sum.amountPence ?? 0) - (aggregate._sum.refundedTotalPence ?? 0));
};

const releaseLayawayStockTx = async (
  tx: Prisma.TransactionClient,
  layaway: {
    id: string;
    saleId: string;
    stockReleasedAt: Date | null;
    reservations: Array<{
      id: string;
      saleItemId: string;
      variantId: string;
      quantity: number;
      stockReleasedAt: Date | null;
    }>;
  },
  staffActorId?: string,
) => {
  if (layaway.stockReleasedAt) {
    return;
  }

  const defaultLocation = await ensureDefaultStockLocationTx(tx);
  const releasedAt = new Date();
  for (const reservation of layaway.reservations) {
    if (reservation.stockReleasedAt) {
      continue;
    }
    await tx.stockLedgerEntry.create({
      data: {
        variantId: reservation.variantId,
        locationId: defaultLocation.id,
        type: "ADJUSTMENT",
        quantityDelta: reservation.quantity,
        referenceType: "LAYAWAY_RELEASE",
        referenceId: reservation.saleItemId,
        note: "Layaway stock released",
        ...(staffActorId ? { createdByStaffId: staffActorId } : {}),
      },
    });
    await tx.inventoryMovement.create({
      data: {
        variantId: reservation.variantId,
        locationId: defaultLocation.id,
        type: "ADJUSTMENT",
        quantity: reservation.quantity,
        referenceType: "LAYAWAY_RELEASE",
        referenceId: reservation.saleItemId,
        note: "Layaway stock released",
        ...(staffActorId ? { createdByStaffId: staffActorId } : {}),
      },
    });
    await tx.layawayReservation.update({
      where: { id: reservation.id },
      data: { stockReleasedAt: releasedAt },
    });
  }

  await tx.layaway.update({
    where: { id: layaway.id },
    data: { stockReleasedAt: releasedAt },
  });
};

const expireUnpaidLayawaysTx = async (tx: Prisma.TransactionClient) => {
  const stale = await tx.layaway.findMany({
    where: {
      status: "ACTIVE",
      depositPaidPence: 0,
      expiresAt: { lt: new Date() },
      stockReleasedAt: null,
    },
    include: {
      reservations: true,
    },
  });

  for (const layaway of stale) {
    await releaseLayawayStockTx(tx, layaway);
    await tx.layaway.update({
      where: { id: layaway.id },
      data: {
        status: "EXPIRED",
        cancelledAt: new Date(),
      },
    });
  }
};

const toLayawayResponse = (layaway: {
  id: string;
  saleId: string;
  basketId: string | null;
  customerId: string | null;
  status: LayawayStatus;
  totalPence: number;
  depositPaidPence: number;
  expiresAt: Date;
  stockReleasedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  sale?: {
    completedAt: Date | null;
    tenders: Array<{ amountPence: number }>;
  };
  customer?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  } | null;
  reservations?: Array<{
    id: string;
    variantId: string;
    quantity: number;
    stockReleasedAt: Date | null;
    saleItem: {
      id: string;
      unitPricePence: number;
      lineTotalPence: number;
      variant: {
        sku: string;
        name: string | null;
        product: { name: string };
      };
    };
  }>;
}) => {
  const tenderedPence = layaway.sale?.tenders.reduce((sum, tender) => sum + tender.amountPence, 0) ?? layaway.depositPaidPence;
  const isOverdue = layaway.expiresAt < new Date() && !layaway.completedAt && !layaway.cancelledAt;
  return {
    id: layaway.id,
    saleId: layaway.saleId,
    basketId: layaway.basketId,
    customerId: layaway.customerId,
    customer: layaway.customer
      ? {
          id: layaway.customer.id,
          name: [layaway.customer.firstName, layaway.customer.lastName].filter(Boolean).join(" ").trim(),
          firstName: layaway.customer.firstName,
          lastName: layaway.customer.lastName,
          email: layaway.customer.email,
          phone: layaway.customer.phone,
        }
      : null,
    status: layaway.status,
    totalPence: layaway.totalPence,
    depositPaidPence: layaway.depositPaidPence,
    tenderedPence,
    remainingPence: Math.max(0, layaway.totalPence - tenderedPence),
    expiresAt: layaway.expiresAt,
    isOverdue,
    requiresReview: isOverdue && layaway.depositPaidPence > 0,
    stockReleasedAt: layaway.stockReleasedAt,
    completedAt: layaway.completedAt,
    cancelledAt: layaway.cancelledAt,
    notes: layaway.notes,
    createdAt: layaway.createdAt,
    updatedAt: layaway.updatedAt,
    items: layaway.reservations?.map((reservation) => ({
      id: reservation.id,
      saleItemId: reservation.saleItem.id,
      variantId: reservation.variantId,
      sku: reservation.saleItem.variant.sku,
      productName: reservation.saleItem.variant.product.name,
      variantName: reservation.saleItem.variant.name,
      quantity: reservation.quantity,
      unitPricePence: reservation.saleItem.unitPricePence,
      lineTotalPence: reservation.saleItem.lineTotalPence,
      stockReleasedAt: reservation.stockReleasedAt,
    })) ?? [],
  };
};

const getLayawayOrThrowTx = async (tx: Prisma.TransactionClient, layawayId: string) => {
  if (!isUuid(layawayId)) {
    throw new HttpError(400, "Invalid layaway id", "INVALID_LAYAWAY_ID");
  }

  const layaway = await tx.layaway.findUnique({
    where: { id: layawayId },
    include: {
      customer: true,
      sale: {
        select: {
          completedAt: true,
          tenders: { select: { amountPence: true } },
        },
      },
      reservations: {
        include: {
          saleItem: {
            include: {
              variant: {
                include: { product: true },
              },
            },
          },
        },
      },
    },
  });

  if (!layaway) {
    throw new HttpError(404, "Layaway not found", "LAYAWAY_NOT_FOUND");
  }

  return layaway;
};

export const createLayawayFromBasket = async (
  basketId: string,
  input: CreateLayawayInput,
  staffActorId?: string,
  locationId?: string,
) => {
  const deposit = normalizeDeposit(input.deposit);
  const expiresAt = resolveExpiryDate(input);
  const checkout = await checkoutBasketToSale(basketId, {}, staffActorId, locationId);

  const layaway = await prisma.$transaction(async (tx) => {
    const existingLayaway = await tx.layaway.findUnique({
      where: { saleId: checkout.sale.id },
    });
    if (existingLayaway) {
      return getLayawayOrThrowTx(tx, existingLayaway.id);
    }

    const sale = await tx.sale.findUnique({
      where: { id: checkout.sale.id },
      include: {
        items: true,
      },
    });
    if (!sale) {
      throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
    }
    if (sale.completedAt) {
      throw new HttpError(409, "Completed sales cannot become layaways", "SALE_ALREADY_COMPLETED");
    }

    const created = await tx.layaway.create({
      data: {
        saleId: sale.id,
        basketId: sale.basketId,
        customerId: sale.customerId,
        status: deposit ? "PART_PAID" : "ACTIVE",
        totalPence: sale.totalPence,
        depositPaidPence: deposit?.amountPence ?? 0,
        expiresAt,
        notes: normalizeOptionalText(input.notes) ?? null,
        ...(staffActorId ? { createdByStaffId: staffActorId } : {}),
      },
    });

    await tx.layawayReservation.createMany({
      data: sale.items.map((item) => ({
        layawayId: created.id,
        saleItemId: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
      })),
    });

    if (deposit) {
      const payment = await tx.payment.create({
        data: {
          saleId: sale.id,
          method: deposit.paymentMethod,
          purpose: "DEPOSIT",
          status: "COMPLETED",
          amountPence: deposit.amountPence,
          ...(deposit.providerRef ? { providerRef: deposit.providerRef } : {}),
        },
      });
      await tx.saleTender.create({
        data: {
          saleId: sale.id,
          method: toSaleTenderMethodFromPaymentMethod(deposit.paymentMethod),
          amountPence: deposit.amountPence,
          createdByStaffId: staffActorId ?? null,
        },
      });
      await recordCashSaleMovementForPaymentTx(tx, {
        paymentId: payment.id,
        paymentMethod: payment.method,
        amountPence: payment.amountPence,
        saleId: sale.id,
        ...(staffActorId ? { createdByStaffId: staffActorId } : {}),
      });
    }

    return getLayawayOrThrowTx(tx, created.id);
  });

  return {
    layaway: toLayawayResponse(layaway),
  };
};

export const listLayaways = async (input: { includeClosed?: boolean } = {}) => {
  await prisma.$transaction((tx) => expireUnpaidLayawaysTx(tx));
  const layaways = await prisma.layaway.findMany({
    where: input.includeClosed
      ? undefined
      : { status: { in: ["ACTIVE", "PART_PAID"] } },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    include: {
      customer: true,
      sale: {
        select: {
          completedAt: true,
          tenders: { select: { amountPence: true } },
        },
      },
      reservations: {
        include: {
          saleItem: {
            include: {
              variant: { include: { product: true } },
            },
          },
        },
      },
    },
  });

  return {
    layaways: layaways.map(toLayawayResponse),
  };
};

export const getLayaway = async (layawayId: string) => {
  await prisma.$transaction((tx) => expireUnpaidLayawaysTx(tx));
  const layaway = await prisma.$transaction((tx) => getLayawayOrThrowTx(tx, layawayId));
  return {
    layaway: toLayawayResponse(layaway),
  };
};

export const cancelLayaway = async (layawayId: string, staffActorId?: string) => {
  const layaway = await prisma.$transaction(async (tx) => {
    const existing = await getLayawayOrThrowTx(tx, layawayId);
    if (existing.completedAt || existing.status === "COMPLETED") {
      throw new HttpError(409, "Completed layaways cannot be cancelled", "LAYAWAY_ALREADY_COMPLETED");
    }
    if (existing.depositPaidPence > 0) {
      throw new HttpError(
        409,
        "Part-paid layaways need a refund or store-credit decision before stock is released",
        "LAYAWAY_PAYMENT_REVIEW_REQUIRED",
      );
    }

    await releaseLayawayStockTx(tx, existing, staffActorId);
    await tx.layaway.update({
      where: { id: existing.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });
    return getLayawayOrThrowTx(tx, existing.id);
  });

  return {
    layaway: toLayawayResponse(layaway),
  };
};

export const completeLayaway = async (layawayId: string, staffActorId?: string) => {
  const layaway = await prisma.$transaction((tx) => getLayawayOrThrowTx(tx, layawayId));
  if (layaway.stockReleasedAt || layaway.status === "CANCELLED" || layaway.status === "EXPIRED") {
    throw new HttpError(409, "Layaway stock has been released", "LAYAWAY_STOCK_RELEASED");
  }
  if (layaway.status === "COMPLETED" || layaway.completedAt) {
    return { layaway: toLayawayResponse(layaway) };
  }

  await completeSaleIfEligible(layaway.saleId, staffActorId ? { staffActorId } : {});
  const updated = await prisma.$transaction(async (tx) => {
    const paidPence = await getPaidPenceTx(tx, layaway.saleId);
    await tx.layaway.update({
      where: { id: layaway.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        depositPaidPence: paidPence,
      },
    });
    return getLayawayOrThrowTx(tx, layaway.id);
  });

  return {
    layaway: toLayawayResponse(updated),
  };
};
