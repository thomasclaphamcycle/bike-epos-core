import { Prisma, RefundRecordStatus, RefundTenderType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { getCustomerDisplayName } from "../utils/customerName";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { recordCashRefundMovementForSaleRefundTx } from "./tillService";

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const toDateOrThrow = (value: string, field: "from" | "to"): Date => {
  if (!DATE_ONLY_REGEX.test(value)) {
    throw new HttpError(400, `${field} must be YYYY-MM-DD`, "INVALID_DATE");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${field} is invalid`, "INVALID_DATE");
  }
  return parsed;
};

const addDays = (date: Date, days: number) => {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
};

type RefundTotals = {
  subtotalPence: number;
  taxPence: number;
  totalPence: number;
};

type RefundSummary = {
  refund: {
    id: string;
    saleId: string;
    status: RefundRecordStatus;
    currency: string;
    subtotalPence: number;
    taxPence: number;
    totalPence: number;
    returnToStock: boolean;
    returnedToStockAt: Date | null;
    computedSubtotalPence: number;
    computedTaxPence: number;
    computedTotalPence: number;
    tenderedPence: number;
    remainingTenderPence: number;
    createdByStaffId: string | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
    receiptNumber: string | null;
  };
  sale: {
    id: string;
    completedAt: Date | null;
    subtotalPence: number;
    taxPence: number;
    totalPence: number;
  };
  lines: Array<{
    id: string;
    refundId: string;
    saleLineId: string;
    quantity: number;
    unitPricePence: number;
    lineTotalPence: number;
    createdAt: Date;
    updatedAt: Date;
    saleLine: {
      id: string;
      saleId: string;
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
    };
  }>;
  tenders: Array<{
    id: string;
    refundId: string;
    tenderType: RefundTenderType;
    amountPence: number;
    meta: Prisma.JsonValue | null;
    createdAt: Date;
    createdByStaffId: string | null;
  }>;
};

type ListRefundsInput = {
  from?: string;
  to?: string;
};

type CreateRefundInput = {
  saleId?: string;
  createdByStaffId?: string;
};

type UpsertRefundLineInput = {
  saleLineId?: string;
  quantity?: number;
};

type AddRefundTenderInput = {
  tenderType?: RefundTenderType;
  amountPence?: number;
  meta?: Prisma.JsonValue;
};

type CompleteRefundInput = {
  completedByStaffId?: string;
  returnToStock?: boolean;
  auditActor?: AuditActor;
};

const computeRefundTotals = (input: {
  saleSubtotalPence: number;
  saleTaxPence: number;
  lineSubtotalPence: number;
}): RefundTotals => {
  if (input.lineSubtotalPence <= 0) {
    return {
      subtotalPence: 0,
      taxPence: 0,
      totalPence: 0,
    };
  }

  const taxPence =
    input.saleSubtotalPence > 0 && input.saleTaxPence > 0
      ? Math.round((input.lineSubtotalPence * input.saleTaxPence) / input.saleSubtotalPence)
      : 0;

  return {
    subtotalPence: input.lineSubtotalPence,
    taxPence,
    totalPence: input.lineSubtotalPence + taxPence,
  };
};

const getCompletedRefundedQtyForSaleLineTx = async (
  tx: Prisma.TransactionClient,
  saleLineId: string,
  excludeRefundId?: string,
) => {
  const aggregate = await tx.refundLine.aggregate({
    where: {
      saleLineId,
      refund: {
        status: "COMPLETED",
        ...(excludeRefundId ? { id: { not: excludeRefundId } } : {}),
      },
    },
    _sum: {
      quantity: true,
    },
  });

  return aggregate._sum.quantity ?? 0;
};

const parseRefundTenderTypeOrThrow = (value: RefundTenderType | undefined): RefundTenderType => {
  if (value !== "CASH" && value !== "CARD" && value !== "VOUCHER" && value !== "OTHER") {
    throw new HttpError(
      400,
      "tenderType must be one of CASH, CARD, VOUCHER, OTHER",
      "INVALID_REFUND_TENDER",
    );
  }
  return value;
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

const lockRefundForUpdateTx = async (tx: Prisma.TransactionClient, refundId: string) => {
  const lockedRows = await tx.$queryRaw<Array<{ id: string; saleId: string }>>`
    SELECT id, "saleId"
    FROM "Refund"
    WHERE id = ${refundId}
    FOR UPDATE
  `;

  if (lockedRows.length === 0) {
    throw new HttpError(404, "Refund not found", "REFUND_NOT_FOUND");
  }

  return lockedRows[0];
};

const lockSaleForRefundCompletionTx = async (
  tx: Prisma.TransactionClient,
  saleId: string,
) => {
  const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "Sale"
    WHERE id = ${saleId}
    FOR UPDATE
  `;

  if (lockedRows.length === 0) {
    throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
  }
};

const getRefundForMutationTx = async (tx: Prisma.TransactionClient, refundId: string) => {
  await lockRefundForUpdateTx(tx, refundId);

  const refund = await tx.refund.findUnique({
    where: { id: refundId },
    select: {
      id: true,
      saleId: true,
      status: true,
      createdByStaffId: true,
      sale: {
        select: {
          id: true,
          completedAt: true,
          subtotalPence: true,
          taxPence: true,
          totalPence: true,
        },
      },
    },
  });

  if (!refund) {
    throw new HttpError(404, "Refund not found", "REFUND_NOT_FOUND");
  }

  return refund;
};

const assertRefundDraft = (status: RefundRecordStatus) => {
  if (status !== "DRAFT") {
    throw new HttpError(409, "Refund can no longer be modified", "REFUND_LOCKED");
  }
};

const assertSaleCompletedForRefund = (completedAt: Date | null) => {
  if (!completedAt) {
    throw new HttpError(409, "Sale must be completed before refunding", "SALE_NOT_COMPLETED");
  }
};

const recomputeAndPersistRefundTotalsTx = async (
  tx: Prisma.TransactionClient,
  refundId: string,
): Promise<RefundTotals> => {
  const refund = await tx.refund.findUnique({
    where: { id: refundId },
    select: {
      id: true,
      sale: {
        select: {
          subtotalPence: true,
          taxPence: true,
        },
      },
      lines: {
        select: {
          lineTotalPence: true,
        },
      },
    },
  });

  if (!refund) {
    throw new HttpError(404, "Refund not found", "REFUND_NOT_FOUND");
  }

  const lineSubtotalPence = refund.lines.reduce((sum, line) => sum + line.lineTotalPence, 0);
  const totals = computeRefundTotals({
    saleSubtotalPence: refund.sale.subtotalPence,
    saleTaxPence: refund.sale.taxPence,
    lineSubtotalPence,
  });

  await tx.refund.update({
    where: { id: refund.id },
    data: {
      subtotalPence: totals.subtotalPence,
      taxPence: totals.taxPence,
      totalPence: totals.totalPence,
    },
  });

  return totals;
};

const toRefundSummary = (refund: {
  id: string;
  saleId: string;
  status: RefundRecordStatus;
  currency: string;
  subtotalPence: number;
  taxPence: number;
  totalPence: number;
  returnToStock: boolean;
  returnedToStockAt: Date | null;
  createdByStaffId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  sale: {
    id: string;
    completedAt: Date | null;
    subtotalPence: number;
    taxPence: number;
    totalPence: number;
  };
  receipt: {
    receiptNumber: string;
  } | null;
  lines: Array<{
    id: string;
    refundId: string;
    saleLineId: string;
    quantity: number;
    unitPricePence: number;
    lineTotalPence: number;
    createdAt: Date;
    updatedAt: Date;
    saleLine: {
      id: string;
      saleId: string;
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
    };
  }>;
  tenders: Array<{
    id: string;
    refundId: string;
    tenderType: RefundTenderType;
    amountPence: number;
    meta: Prisma.JsonValue | null;
    createdAt: Date;
    createdByStaffId: string | null;
  }>;
}): RefundSummary => {
  const lineSubtotalPence = refund.lines.reduce((sum, line) => sum + line.lineTotalPence, 0);
  const computed = computeRefundTotals({
    saleSubtotalPence: refund.sale.subtotalPence,
    saleTaxPence: refund.sale.taxPence,
    lineSubtotalPence,
  });
  const tenderedPence = refund.tenders.reduce((sum, tender) => sum + tender.amountPence, 0);

  return {
    refund: {
      id: refund.id,
      saleId: refund.saleId,
      status: refund.status,
      currency: refund.currency,
      subtotalPence: refund.subtotalPence,
      taxPence: refund.taxPence,
      totalPence: refund.totalPence,
      returnToStock: refund.returnToStock,
      returnedToStockAt: refund.returnedToStockAt,
      computedSubtotalPence: computed.subtotalPence,
      computedTaxPence: computed.taxPence,
      computedTotalPence: computed.totalPence,
      tenderedPence,
      remainingTenderPence: Math.max(0, computed.totalPence - tenderedPence),
      createdByStaffId: refund.createdByStaffId,
      createdAt: refund.createdAt,
      updatedAt: refund.updatedAt,
      completedAt: refund.completedAt,
      receiptNumber: refund.receipt?.receiptNumber ?? null,
    },
    sale: {
      id: refund.sale.id,
      completedAt: refund.sale.completedAt,
      subtotalPence: refund.sale.subtotalPence,
      taxPence: refund.sale.taxPence,
      totalPence: refund.sale.totalPence,
    },
    lines: refund.lines,
    tenders: refund.tenders,
  };
};

const getRefundSummaryTx = async (
  tx: Prisma.TransactionClient,
  refundId: string,
): Promise<RefundSummary> => {
  const refund = await tx.refund.findUnique({
    where: { id: refundId },
    include: {
      sale: {
        select: {
          id: true,
          completedAt: true,
          subtotalPence: true,
          taxPence: true,
          totalPence: true,
        },
      },
      receipt: {
        select: {
          receiptNumber: true,
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
  });

  if (!refund) {
    throw new HttpError(404, "Refund not found", "REFUND_NOT_FOUND");
  }

  return toRefundSummary(refund);
};

export const createRefund = async (input: CreateRefundInput) => {
  const saleId = normalizeOptionalText(input.saleId);
  if (!saleId || !isUuid(saleId)) {
    throw new HttpError(400, "saleId must be a valid UUID", "INVALID_SALE_ID");
  }

  const createdByStaffId = normalizeOptionalText(input.createdByStaffId);

  return prisma.$transaction(async (tx) => {
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
    assertSaleCompletedForRefund(sale.completedAt);

    const refund = await tx.refund.create({
      data: {
        saleId,
        status: "DRAFT",
        createdByStaffId: createdByStaffId ?? null,
      },
      select: {
        id: true,
      },
    });

    return {
      ...(await getRefundSummaryTx(tx, refund.id)),
      idempotent: false,
    };
  });
};

export const getRefundById = async (refundId: string) => {
  if (!isUuid(refundId)) {
    throw new HttpError(400, "Invalid refund id", "INVALID_REFUND_ID");
  }

  return getRefundSummaryTx(prisma, refundId);
};

export const upsertRefundLine = async (refundId: string, input: UpsertRefundLineInput) => {
  if (!isUuid(refundId)) {
    throw new HttpError(400, "Invalid refund id", "INVALID_REFUND_ID");
  }

  const saleLineId = normalizeOptionalText(input.saleLineId);
  if (!saleLineId || !isUuid(saleLineId)) {
    throw new HttpError(400, "saleLineId must be a valid UUID", "INVALID_SALE_LINE_ID");
  }

  if (!Number.isInteger(input.quantity) || (input.quantity ?? 0) <= 0) {
    throw new HttpError(400, "quantity must be a positive integer", "INVALID_REFUND_LINE");
  }
  const quantity = input.quantity as number;

  return prisma.$transaction(async (tx) => {
    const refund = await getRefundForMutationTx(tx, refundId);
    assertRefundDraft(refund.status);
    assertSaleCompletedForRefund(refund.sale.completedAt);

    const saleLine = await tx.saleItem.findUnique({
      where: { id: saleLineId },
      select: {
        id: true,
        saleId: true,
        quantity: true,
        unitPricePence: true,
      },
    });

    if (!saleLine || saleLine.saleId !== refund.saleId) {
      throw new HttpError(
        404,
        "Sale line not found for this refund",
        "REFUND_LINE_NOT_FOUND",
      );
    }

    const completedElsewhere = await getCompletedRefundedQtyForSaleLineTx(tx, saleLine.id, refund.id);
    const maxRefundableQty = Math.max(0, saleLine.quantity - completedElsewhere);

    if (quantity > maxRefundableQty) {
      throw new HttpError(
        409,
        "Refund quantity exceeds remaining refundable quantity",
        "REFUND_QUANTITY_EXCEEDED",
      );
    }

    const lineTotalPence = saleLine.unitPricePence * quantity;

    const line = await tx.refundLine.upsert({
      where: {
        refundId_saleLineId: {
          refundId: refund.id,
          saleLineId: saleLine.id,
        },
      },
      create: {
        refundId: refund.id,
        saleLineId: saleLine.id,
        quantity,
        unitPricePence: saleLine.unitPricePence,
        lineTotalPence,
      },
      update: {
        quantity,
        unitPricePence: saleLine.unitPricePence,
        lineTotalPence,
      },
      select: {
        id: true,
        refundId: true,
        saleLineId: true,
        quantity: true,
        unitPricePence: true,
        lineTotalPence: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await recomputeAndPersistRefundTotalsTx(tx, refund.id);

    return {
      line,
      ...(await getRefundSummaryTx(tx, refund.id)),
    };
  });
};

export const deleteRefundLine = async (refundId: string, refundLineId: string) => {
  if (!isUuid(refundId)) {
    throw new HttpError(400, "Invalid refund id", "INVALID_REFUND_ID");
  }
  if (!isUuid(refundLineId)) {
    throw new HttpError(400, "Invalid refund line id", "INVALID_REFUND_LINE_ID");
  }

  return prisma.$transaction(async (tx) => {
    const refund = await getRefundForMutationTx(tx, refundId);
    assertRefundDraft(refund.status);

    const existingLine = await tx.refundLine.findUnique({
      where: { id: refundLineId },
      select: {
        id: true,
        refundId: true,
      },
    });

    if (!existingLine || existingLine.refundId !== refund.id) {
      throw new HttpError(404, "Refund line not found", "REFUND_LINE_NOT_FOUND");
    }

    await tx.refundLine.delete({
      where: { id: refundLineId },
    });

    await recomputeAndPersistRefundTotalsTx(tx, refund.id);

    return getRefundSummaryTx(tx, refund.id);
  });
};

export const addRefundTender = async (
  refundId: string,
  input: AddRefundTenderInput,
  createdByStaffId?: string,
) => {
  if (!isUuid(refundId)) {
    throw new HttpError(400, "Invalid refund id", "INVALID_REFUND_ID");
  }

  const tenderType = parseRefundTenderTypeOrThrow(input.tenderType);

  if (!Number.isInteger(input.amountPence) || (input.amountPence ?? 0) <= 0) {
    throw new HttpError(400, "amountPence must be a positive integer", "INVALID_REFUND_TENDER");
  }
  const amountPence = input.amountPence as number;

  const normalizedCreatedByStaffId = normalizeOptionalText(createdByStaffId);

  return prisma.$transaction(async (tx) => {
    const refund = await getRefundForMutationTx(tx, refundId);
    assertRefundDraft(refund.status);

    const tender = await tx.refundTender.create({
      data: {
        refundId: refund.id,
        tenderType,
        amountPence,
        meta: input.meta,
        createdByStaffId: normalizedCreatedByStaffId ?? null,
      },
      select: {
        id: true,
        refundId: true,
        tenderType: true,
        amountPence: true,
        meta: true,
        createdAt: true,
        createdByStaffId: true,
      },
    });

    return {
      tender,
      ...(await getRefundSummaryTx(tx, refund.id)),
    };
  });
};

export const deleteRefundTender = async (refundId: string, tenderId: string) => {
  if (!isUuid(refundId)) {
    throw new HttpError(400, "Invalid refund id", "INVALID_REFUND_ID");
  }
  if (!isUuid(tenderId)) {
    throw new HttpError(400, "Invalid tender id", "INVALID_REFUND_TENDER_ID");
  }

  return prisma.$transaction(async (tx) => {
    const refund = await getRefundForMutationTx(tx, refundId);
    assertRefundDraft(refund.status);

    const tender = await tx.refundTender.findUnique({
      where: { id: tenderId },
      select: {
        id: true,
        refundId: true,
      },
    });

    if (!tender || tender.refundId !== refund.id) {
      throw new HttpError(404, "Refund tender not found", "REFUND_TENDER_NOT_FOUND");
    }

    await tx.refundTender.delete({
      where: { id: tender.id },
    });

    return getRefundSummaryTx(tx, refund.id);
  });
};

const assertRefundLineQuantitiesStillValidTx = async (
  tx: Prisma.TransactionClient,
  refundId: string,
  lines: Array<{
    saleLineId: string;
    quantity: number;
  }>,
) => {
  for (const line of lines) {
    const saleLine = await tx.saleItem.findUnique({
      where: { id: line.saleLineId },
      select: {
        id: true,
        quantity: true,
      },
    });

    if (!saleLine) {
      throw new HttpError(409, "Refund contains missing sale line", "REFUND_LINE_NOT_FOUND");
    }

    const completedElsewhere = await getCompletedRefundedQtyForSaleLineTx(tx, line.saleLineId, refundId);
    const maxRefundableQty = Math.max(0, saleLine.quantity - completedElsewhere);

    if (line.quantity > maxRefundableQty) {
      throw new HttpError(
        409,
        "Refund quantity exceeds remaining refundable quantity",
        "REFUND_QUANTITY_EXCEEDED",
      );
    }
  }
};

export const completeRefund = async (refundId: string, input: CompleteRefundInput = {}) => {
  if (!isUuid(refundId)) {
    throw new HttpError(400, "Invalid refund id", "INVALID_REFUND_ID");
  }

  const normalizedCompletedByStaffId = normalizeOptionalText(input.completedByStaffId);
  const returnToStock = input.returnToStock === true;

  return prisma.$transaction(async (tx) => {
    const lockedRefund = await lockRefundForUpdateTx(tx, refundId);
    await lockSaleForRefundCompletionTx(tx, lockedRefund.saleId);

    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      include: {
        sale: {
          select: {
            id: true,
            locationId: true,
            completedAt: true,
            subtotalPence: true,
            taxPence: true,
          },
        },
        lines: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            saleLineId: true,
            quantity: true,
            lineTotalPence: true,
            saleLine: {
              select: {
                variantId: true,
              },
            },
          },
        },
        tenders: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            amountPence: true,
            tenderType: true,
          },
        },
      },
    });

    if (!refund) {
      throw new HttpError(404, "Refund not found", "REFUND_NOT_FOUND");
    }

    if (refund.status === "COMPLETED") {
      return {
        ...(await getRefundSummaryTx(tx, refund.id)),
        idempotent: true,
      };
    }

    assertRefundDraft(refund.status);
    assertSaleCompletedForRefund(refund.sale.completedAt);

    if (refund.lines.length === 0) {
      throw new HttpError(
        409,
        "Refund must include at least one line before completion",
        "REFUND_LINES_REQUIRED",
      );
    }

    await assertRefundLineQuantitiesStillValidTx(
      tx,
      refund.id,
      refund.lines.map((line) => ({
        saleLineId: line.saleLineId,
        quantity: line.quantity,
      })),
    );

    const lineSubtotalPence = refund.lines.reduce((sum, line) => sum + line.lineTotalPence, 0);
    const totals = computeRefundTotals({
      saleSubtotalPence: refund.sale.subtotalPence,
      saleTaxPence: refund.sale.taxPence,
      lineSubtotalPence,
    });

    const tenderedPence = refund.tenders.reduce((sum, tender) => sum + tender.amountPence, 0);
    if (tenderedPence !== totals.totalPence) {
      throw new HttpError(
        409,
        "Refund tenders must exactly match refund total",
        "REFUND_TENDER_MISMATCH",
      );
    }

    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: "COMPLETED",
        subtotalPence: totals.subtotalPence,
        taxPence: totals.taxPence,
        totalPence: totals.totalPence,
        returnToStock,
        returnedToStockAt: returnToStock ? new Date() : null,
        completedAt: new Date(),
      },
    });

    if (returnToStock) {
      const defaultStockLocation = await getOrCreateDefaultStockLocationTx(tx);
      for (const line of refund.lines) {
        await tx.stockLedgerEntry.create({
          data: {
            variantId: line.saleLine.variantId,
            locationId: defaultStockLocation.id,
            type: "RETURN",
            quantityDelta: line.quantity,
            referenceType: "SALE_REFUND_LINE",
            referenceId: line.id,
            note: `Refund ${refund.id} return to stock`,
          },
        });

        await tx.inventoryMovement.create({
          data: {
            variantId: line.saleLine.variantId,
            locationId: defaultStockLocation.id,
            type: "RETURN",
            quantity: line.quantity,
            referenceType: "SALE_REFUND_LINE",
            referenceId: line.id,
            note: `Refund ${refund.id} return to stock`,
            createdByStaffId: normalizedCompletedByStaffId ?? refund.createdByStaffId ?? null,
          },
        });
      }
    }

    const cashTenderedPence = refund.tenders
      .filter((tender) => tender.tenderType === "CASH")
      .reduce((sum, tender) => sum + tender.amountPence, 0);

    await recordCashRefundMovementForSaleRefundTx(tx, {
      saleRefundId: refund.id,
      saleId: refund.saleId,
      cashTenderedPence,
      createdByStaffId: normalizedCompletedByStaffId ?? refund.createdByStaffId ?? undefined,
    });

    const refundAuditMetadata = {
      saleId: refund.saleId,
      lineCount: refund.lines.length,
      totalPence: totals.totalPence,
      tenderedPence,
      cashTenderedPence,
      returnToStock,
    };

    await createAuditEventTx(
      tx,
      {
        action: "REFUND_COMPLETED",
        entityType: "REFUND",
        entityId: refund.id,
        metadata: refundAuditMetadata,
      },
      input.auditActor,
    );

    await createAuditEventTx(
      tx,
      {
        action: "REFUND_ISSUED",
        entityType: "REFUND",
        entityId: refund.id,
        metadata: refundAuditMetadata,
      },
      input.auditActor,
    );

    if (returnToStock) {
      await createAuditEventTx(
        tx,
        {
          action: "RETURN_TO_STOCK",
          entityType: "REFUND",
          entityId: refund.id,
          metadata: {
            saleId: refund.saleId,
            lines: refund.lines.length,
            quantityReturned: refund.lines.reduce((sum, line) => sum + line.quantity, 0),
          },
        },
        input.auditActor,
      );
    }

    return {
      ...(await getRefundSummaryTx(tx, refund.id)),
      idempotent: false,
    };
  });
};

export const listCompletedRefunds = async (input: ListRefundsInput = {}) => {
  const fromValue = normalizeOptionalText(input.from);
  const toValue = normalizeOptionalText(input.to);

  const fromDate = fromValue ? toDateOrThrow(fromValue, "from") : undefined;
  const toDateExclusive = toValue ? addDays(toDateOrThrow(toValue, "to"), 1) : undefined;

  if (fromDate && toDateExclusive && fromDate >= toDateExclusive) {
    throw new HttpError(400, "from must be before or equal to to", "INVALID_DATE_RANGE");
  }

  const refunds = await prisma.refund.findMany({
    where: {
      status: "COMPLETED",
      ...(fromDate || toDateExclusive
        ? {
            completedAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDateExclusive ? { lt: toDateExclusive } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      receipt: {
        select: {
          receiptNumber: true,
        },
      },
      sale: {
        select: {
          id: true,
          receiptNumber: true,
          completedAt: true,
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
      tenders: {
        select: {
          tenderType: true,
          amountPence: true,
        },
      },
      lines: {
        select: {
          quantity: true,
          lineTotalPence: true,
        },
      },
    },
  });

  return {
    refunds: refunds.map((refund) => ({
      id: refund.id,
      saleId: refund.saleId,
      status: refund.status,
      currency: refund.currency,
      subtotalPence: refund.subtotalPence,
      taxPence: refund.taxPence,
      totalPence: refund.totalPence,
      completedAt: refund.completedAt,
      createdAt: refund.createdAt,
      receiptNumber: refund.receipt?.receiptNumber ?? null,
      saleReceiptNumber: refund.sale.receiptNumber,
      lineCount: refund.lines.length,
      refundedUnits: refund.lines.reduce((sum, line) => sum + line.quantity, 0),
      tenderedPence: refund.tenders.reduce((sum, tender) => sum + tender.amountPence, 0),
      cashTenderPence: refund.tenders
        .filter((tender) => tender.tenderType === "CASH")
        .reduce((sum, tender) => sum + tender.amountPence, 0),
      customer: refund.sale.customer
        ? {
            id: refund.sale.customer.id,
            name: getCustomerDisplayName(refund.sale.customer, ""),
          }
        : null,
    })),
  };
};
