import { CashMovementReason, CashMovementType, CashSessionStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toCsv } from "../utils/csv";
import { HttpError, isUuid } from "../utils/http";

type OpenCashSessionInput = {
  openingFloatPence?: number;
  businessDate?: string;
  openedByStaffId?: string;
};

type AddPaidMovementInput = {
  type?: string;
  amountPence?: number;
  ref?: string;
  note?: string;
  reason?: CashMovementReason;
  receiptImageUrl?: string;
  createdByStaffId?: string;
};

type RecordCashCountInput = {
  countedCashPence?: number;
  notes?: string;
  countedByStaffId?: string;
};

type ListCashSessionsInput = {
  from?: string;
  to?: string;
};

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const DEFAULT_CASH_LOCATION_ID = "default";

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toDateStartOrThrow = (value: string, field: "from" | "to" | "businessDate") => {
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

const toNonNegativeIntOrThrow = (value: number | undefined, field: string, code: string) => {
  if (!Number.isInteger(value) || (value ?? -1) < 0) {
    throw new HttpError(400, `${field} must be a non-negative integer`, code);
  }
  return value as number;
};

const parsePaidMovementTypeOrThrow = (value: string | undefined): CashMovementType => {
  const normalized = normalizeOptionalText(value)?.toUpperCase();
  if (normalized !== "PAID_IN" && normalized !== "PAID_OUT") {
    throw new HttpError(400, "type must be PAID_IN or PAID_OUT", "INVALID_TILL_MOVEMENT");
  }
  return normalized;
};

const toBusinessDate = (inputDate?: string) => {
  if (inputDate) {
    return toDateStartOrThrow(inputDate, "businessDate");
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const getOpenSessionTx = async (tx: Prisma.TransactionClient) =>
  tx.cashSession.findFirst({
    where: { status: CashSessionStatus.OPEN },
    orderBy: [{ openedAt: "desc" }],
  });

const getSessionByIdTx = async (tx: Prisma.TransactionClient, sessionId: string) => {
  if (!isUuid(sessionId)) {
    throw new HttpError(400, "Invalid session id", "INVALID_SESSION_ID");
  }
  const session = await tx.cashSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) {
    throw new HttpError(404, "Cash session not found", "SESSION_NOT_FOUND");
  }
  return session;
};

const createMovementTx = async (
  tx: Prisma.TransactionClient,
  input: {
    sessionId: string;
    type: CashMovementType;
    amountPence: number;
    ref: string;
    locationId?: string;
    note?: string;
    reason?: CashMovementReason;
    receiptImageUrl?: string;
    relatedSaleId?: string;
    relatedRefundId?: string;
    createdByStaffId?: string;
  },
) =>
  tx.cashMovement.create({
    data: {
      sessionId: input.sessionId,
      locationId: input.locationId ?? DEFAULT_CASH_LOCATION_ID,
      type: input.type,
      amountPence: input.amountPence,
      ref: input.ref,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.receiptImageUrl !== undefined ? { receiptImageUrl: input.receiptImageUrl } : {}),
      ...(input.relatedSaleId !== undefined ? { relatedSaleId: input.relatedSaleId } : {}),
      ...(input.relatedRefundId !== undefined ? { relatedRefundId: input.relatedRefundId } : {}),
      ...(input.createdByStaffId !== undefined ? { createdByStaffId: input.createdByStaffId } : {}),
    },
  });

const getMovementTotalsTx = async (tx: Prisma.TransactionClient, sessionId: string) => {
  const rows = await tx.cashMovement.groupBy({
    by: ["type"],
    where: { sessionId },
    _sum: { amountPence: true },
  });

  const totals = {
    floatIn: 0,
    paidIn: 0,
    paidOut: 0,
    cashSales: 0,
    cashRefunds: 0,
  };

  for (const row of rows) {
    const amount = row._sum.amountPence ?? 0;
    switch (row.type) {
      case "FLOAT_IN":
        totals.floatIn += amount;
        break;
      case "PAID_IN":
        totals.paidIn += amount;
        break;
      case "PAID_OUT":
        totals.paidOut += amount;
        break;
      case "CASH_SALE":
        totals.cashSales += amount;
        break;
      case "CASH_REFUND":
        totals.cashRefunds += amount;
        break;
    }
  }

  return totals;
};

const toSessionResponse = (session: {
  id: string;
  businessDate: Date;
  openedAt: Date;
  closedAt: Date | null;
  openedByStaffId: string | null;
  closedByStaffId: string | null;
  openingFloatPence: number;
  status: CashSessionStatus;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: session.id,
  businessDate: session.businessDate,
  openedAt: session.openedAt,
  closedAt: session.closedAt,
  openedByStaffId: session.openedByStaffId,
  closedByStaffId: session.closedByStaffId,
  openingFloatPence: session.openingFloatPence,
  status: session.status,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
});

const getSessionSummaryTx = async (tx: Prisma.TransactionClient, sessionId: string) => {
  const session = await getSessionByIdTx(tx, sessionId);
  const totals = await getMovementTotalsTx(tx, session.id);
  const count = await tx.cashCount.findUnique({
    where: { sessionId: session.id },
  });

  const expectedCashPence =
    session.openingFloatPence +
    totals.paidIn -
    totals.paidOut +
    totals.cashSales -
    totals.cashRefunds;

  const countedCashPence = count?.countedCashPence ?? null;
  const variancePence =
    countedCashPence === null ? null : countedCashPence - expectedCashPence;

  return {
    session: toSessionResponse(session),
    totals: {
      openingFloatPence: session.openingFloatPence,
      paidInPence: totals.paidIn,
      paidOutPence: totals.paidOut,
      cashSalesPence: totals.cashSales,
      cashRefundsPence: totals.cashRefunds,
      expectedCashPence,
      countedCashPence,
      variancePence,
    },
    cashCount: count
      ? {
          id: count.id,
          countedCashPence: count.countedCashPence,
          notes: count.notes,
          countedAt: count.countedAt,
          countedByStaffId: count.countedByStaffId,
        }
      : null,
  };
};

export const openCashSession = async (input: OpenCashSessionInput) => {
  const openingFloatPence = toNonNegativeIntOrThrow(
    input.openingFloatPence,
    "openingFloatPence",
    "INVALID_CASH_SESSION",
  );
  const businessDate = toBusinessDate(input.businessDate);

  return prisma.$transaction(async (tx) => {
    const currentOpen = await getOpenSessionTx(tx);
    if (currentOpen) {
      throw new HttpError(409, "A cash session is already open", "SESSION_ALREADY_OPEN");
    }

    const session = await tx.cashSession.create({
      data: {
        businessDate,
        openingFloatPence,
        status: CashSessionStatus.OPEN,
        openedByStaffId: input.openedByStaffId ?? null,
      },
    });

    await createMovementTx(tx, {
      sessionId: session.id,
      type: "FLOAT_IN",
      amountPence: openingFloatPence,
      ref: `OPEN_FLOAT:${session.id}`,
      ...(input.openedByStaffId ? { createdByStaffId: input.openedByStaffId } : {}),
    });

    return getSessionSummaryTx(tx, session.id);
  });
};

export const addPaidMovement = async (sessionId: string, input: AddPaidMovementInput) => {
  const type = parsePaidMovementTypeOrThrow(input.type);
  const amountPence = toNonNegativeIntOrThrow(
    input.amountPence,
    "amountPence",
    "INVALID_TILL_MOVEMENT",
  );
  if (amountPence === 0) {
    throw new HttpError(400, "amountPence must be greater than zero", "INVALID_TILL_MOVEMENT");
  }
  const ref = normalizeOptionalText(input.ref) ?? `${type}:${Date.now()}`;
  const note = normalizeOptionalText(input.note);

  return prisma.$transaction(async (tx) => {
    const session = await getSessionByIdTx(tx, sessionId);
    if (session.status !== CashSessionStatus.OPEN) {
      throw new HttpError(409, "Session is already closed", "SESSION_CLOSED");
    }

    const movement = await createMovementTx(tx, {
      sessionId: session.id,
      type,
      amountPence,
      ref,
      ...(note ? { note } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.receiptImageUrl ? { receiptImageUrl: input.receiptImageUrl } : {}),
      ...(input.createdByStaffId ? { createdByStaffId: input.createdByStaffId } : {}),
    });

    const summary = await getSessionSummaryTx(tx, session.id);

    return {
      movement: {
        id: movement.id,
        sessionId: movement.sessionId,
        locationId: movement.locationId,
        type: movement.type,
        reason: movement.reason,
        amountPence: movement.amountPence,
        ref: movement.ref,
        note: movement.note,
        receiptImageUrl: movement.receiptImageUrl,
        relatedSaleId: movement.relatedSaleId,
        relatedRefundId: movement.relatedRefundId,
        createdAt: movement.createdAt,
        createdByStaffId: movement.createdByStaffId,
      },
      summary,
    };
  });
};

export const recordCashCount = async (sessionId: string, input: RecordCashCountInput) => {
  const countedCashPence = toNonNegativeIntOrThrow(
    input.countedCashPence,
    "countedCashPence",
    "INVALID_CASH_COUNT",
  );
  const notes = normalizeOptionalText(input.notes) ?? null;

  return prisma.$transaction(async (tx) => {
    const session = await getSessionByIdTx(tx, sessionId);
    if (session.status !== CashSessionStatus.OPEN) {
      throw new HttpError(409, "Session is already closed", "SESSION_CLOSED");
    }

    const count = await tx.cashCount.upsert({
      where: { sessionId: session.id },
      create: {
        sessionId: session.id,
        countedCashPence,
        notes,
        countedByStaffId: input.countedByStaffId ?? null,
      },
      update: {
        countedCashPence,
        notes,
        countedByStaffId: input.countedByStaffId ?? null,
        countedAt: new Date(),
      },
    });

    const summary = await getSessionSummaryTx(tx, session.id);
    return {
      count: {
        id: count.id,
        sessionId: count.sessionId,
        countedCashPence: count.countedCashPence,
        notes: count.notes,
        countedAt: count.countedAt,
        countedByStaffId: count.countedByStaffId,
      },
      summary,
    };
  });
};

export const closeCashSession = async (sessionId: string, closedByStaffId?: string) =>
  prisma.$transaction(async (tx) => {
    const session = await getSessionByIdTx(tx, sessionId);
    if (session.status === CashSessionStatus.CLOSED) {
      return {
        ...(await getSessionSummaryTx(tx, session.id)),
        idempotent: true,
      };
    }

    const existingCount = await tx.cashCount.findUnique({
      where: { sessionId: session.id },
      select: { id: true },
    });
    if (!existingCount) {
      throw new HttpError(409, "Cannot close session without cash count", "CASH_COUNT_REQUIRED");
    }

    await tx.cashSession.update({
      where: { id: session.id },
      data: {
        status: CashSessionStatus.CLOSED,
        closedAt: new Date(),
        closedByStaffId: closedByStaffId ?? null,
      },
    });

    return {
      ...(await getSessionSummaryTx(tx, session.id)),
      idempotent: false,
    };
  });

export const getCurrentCashSession = async () => {
  const session = await prisma.cashSession.findFirst({
    where: { status: CashSessionStatus.OPEN },
    orderBy: [{ openedAt: "desc" }],
  });

  if (!session) {
    return { session: null };
  }

  const summary = await getCashSessionSummary(session.id);
  return summary;
};

export const listCashSessions = async (input: ListCashSessionsInput) => {
  const normalizedFrom = normalizeOptionalText(input.from);
  const normalizedTo = normalizeOptionalText(input.to);

  const fromDate = normalizedFrom ? toDateStartOrThrow(normalizedFrom, "from") : undefined;
  const toDateExclusive = normalizedTo
    ? addDays(toDateStartOrThrow(normalizedTo, "to"), 1)
    : undefined;

  if (fromDate && toDateExclusive && fromDate >= toDateExclusive) {
    throw new HttpError(400, "from must be before or equal to to", "INVALID_DATE_RANGE");
  }

  const sessions = await prisma.cashSession.findMany({
    where: {
      ...(fromDate || toDateExclusive
        ? {
            businessDate: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDateExclusive ? { lt: toDateExclusive } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ businessDate: "desc" }, { openedAt: "desc" }],
    take: 100,
  });

  return {
    sessions: sessions.map((session) => toSessionResponse(session)),
  };
};

export const getCashSessionSummary = async (sessionId: string) =>
  prisma.$transaction((tx) => getSessionSummaryTx(tx, sessionId));

export const getCashSessionSummaryCsv = async (sessionId: string) => {
  const summary = await getCashSessionSummary(sessionId);

  return toCsv(
    [
      {
        sessionId: summary.session.id,
        businessDate: summary.session.businessDate.toISOString().slice(0, 10),
        status: summary.session.status,
        openingFloatPence: summary.totals.openingFloatPence,
        paidInPence: summary.totals.paidInPence,
        paidOutPence: summary.totals.paidOutPence,
        cashSalesPence: summary.totals.cashSalesPence,
        cashRefundsPence: summary.totals.cashRefundsPence,
        expectedCashPence: summary.totals.expectedCashPence,
        countedCashPence: summary.totals.countedCashPence ?? "",
        variancePence: summary.totals.variancePence ?? "",
      },
    ],
    [
      { header: "sessionId", value: (row) => row.sessionId },
      { header: "businessDate", value: (row) => row.businessDate },
      { header: "status", value: (row) => row.status },
      { header: "openingFloatPence", value: (row) => row.openingFloatPence },
      { header: "paidInPence", value: (row) => row.paidInPence },
      { header: "paidOutPence", value: (row) => row.paidOutPence },
      { header: "cashSalesPence", value: (row) => row.cashSalesPence },
      { header: "cashRefundsPence", value: (row) => row.cashRefundsPence },
      { header: "expectedCashPence", value: (row) => row.expectedCashPence },
      { header: "countedCashPence", value: (row) => row.countedCashPence },
      { header: "variancePence", value: (row) => row.variancePence },
    ],
  );
};

export const recordCashSaleMovementForPaymentTx = async (
  tx: Prisma.TransactionClient,
  input: {
    paymentId: string;
    paymentMethod: string;
    amountPence: number;
    saleId?: string;
    createdByStaffId?: string;
  },
) => {
  if (input.paymentMethod !== "CASH") {
    return;
  }

  const openSession = await getOpenSessionTx(tx);
  if (!openSession) {
    throw new HttpError(
      409,
      "No open register session. Open the till before taking a cash sale.",
      "REGISTER_SESSION_REQUIRED",
    );
  }

  try {
    await createMovementTx(tx, {
      sessionId: openSession.id,
      type: "CASH_SALE",
      amountPence: input.amountPence,
      ref: `PAYMENT:${input.paymentId}`,
      ...(input.saleId ? { relatedSaleId: input.saleId } : {}),
      ...(input.createdByStaffId ? { createdByStaffId: input.createdByStaffId } : {}),
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code !== "P2002") {
      throw error;
    }
  }
};

export const recordCashSaleMovementForSaleTx = async (
  tx: Prisma.TransactionClient,
  input: {
    saleId: string;
    cashTenderedPence: number;
    changeDuePence: number;
    createdByStaffId?: string;
  },
) => {
  const netCashPence = Math.max(0, input.cashTenderedPence - Math.max(0, input.changeDuePence));
  if (netCashPence <= 0) {
    return;
  }

  // Legacy flows that create Payment(method=CASH) already record movement by payment id.
  const existingCashPayment = await tx.payment.findFirst({
    where: {
      saleId: input.saleId,
      method: "CASH",
      amountPence: { gt: 0 },
    },
    select: { id: true },
  });
  if (existingCashPayment) {
    return;
  }

  const openSession = await getOpenSessionTx(tx);
  if (!openSession) {
    return;
  }

  try {
    await createMovementTx(tx, {
      sessionId: openSession.id,
      type: "CASH_SALE",
      amountPence: netCashPence,
      ref: `SALE_TENDER:${input.saleId}`,
      relatedSaleId: input.saleId,
      ...(input.createdByStaffId ? { createdByStaffId: input.createdByStaffId } : {}),
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code !== "P2002") {
      throw error;
    }
  }
};

export const recordCashRefundMovementForRefundTx = async (
  tx: Prisma.TransactionClient,
  input: {
    paymentId: string;
    paymentMethod: string;
    paymentRefundId: string;
    amountPence: number;
    saleId?: string | null;
    createdByStaffId?: string;
  },
) => {
  if (input.paymentMethod !== "CASH") {
    return;
  }

  const openSession = await getOpenSessionTx(tx);
  if (!openSession) {
    return;
  }

  try {
    await createMovementTx(tx, {
      sessionId: openSession.id,
      type: "CASH_REFUND",
      amountPence: input.amountPence,
      ref: `REFUND:${input.paymentRefundId}:PAYMENT:${input.paymentId}`,
      ...(input.saleId ? { relatedSaleId: input.saleId } : {}),
      ...(input.createdByStaffId ? { createdByStaffId: input.createdByStaffId } : {}),
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code !== "P2002") {
      throw error;
    }
  }
};

export const recordCashRefundMovementForPaymentTx = async (
  tx: Prisma.TransactionClient,
  input: {
    paymentId: string;
    paymentMethod: string;
    amountPence: number;
    saleId?: string | null;
    ref?: string;
    createdByStaffId?: string;
  },
) => {
  if (input.paymentMethod !== "CASH") {
    return;
  }

  const openSession = await getOpenSessionTx(tx);
  if (!openSession) {
    return;
  }

  const amountPence = Math.abs(input.amountPence);
  if (amountPence <= 0) {
    return;
  }

  try {
    await createMovementTx(tx, {
      sessionId: openSession.id,
      type: "CASH_REFUND",
      amountPence,
      ref: input.ref ?? `PAYMENT_REFUND:${input.paymentId}`,
      ...(input.saleId ? { relatedSaleId: input.saleId } : {}),
      ...(input.createdByStaffId ? { createdByStaffId: input.createdByStaffId } : {}),
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code !== "P2002") {
      throw error;
    }
  }
};

export const recordCashRefundMovementForSaleRefundTx = async (
  tx: Prisma.TransactionClient,
  input: {
    saleRefundId: string;
    saleId: string;
    cashTenderedPence: number;
    createdByStaffId?: string;
  },
) => {
  const amountPence = Math.abs(input.cashTenderedPence);
  if (amountPence <= 0) {
    return;
  }

  const openSession = await getOpenSessionTx(tx);
  if (!openSession) {
    return;
  }

  try {
    await createMovementTx(tx, {
      sessionId: openSession.id,
      type: "CASH_REFUND",
      amountPence,
      ref: `SALE_REFUND:${input.saleRefundId}`,
      relatedSaleId: input.saleId,
      relatedRefundId: input.saleRefundId,
      ...(input.createdByStaffId ? { createdByStaffId: input.createdByStaffId } : {}),
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code !== "P2002") {
      throw error;
    }
  }
};
