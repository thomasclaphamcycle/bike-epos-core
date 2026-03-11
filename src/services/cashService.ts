import { CashMovementType, CashSessionStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { DEFAULT_CASH_LOCATION_ID } from "./tillService";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

type ManualCashMovementType = "FLOAT" | "PAID_IN" | "PAID_OUT";

type CreateCashMovementInput = {
  type?: ManualCashMovementType;
  amountPence?: number;
  note?: string;
  locationId?: string;
  createdByStaffId?: string;
};

type DateRangeInput = {
  from?: string;
  to?: string;
};

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toDateOrThrow = (value: string, field: "from" | "to") => {
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

const toDbMovementTypeOrThrow = (value: ManualCashMovementType | undefined): CashMovementType => {
  if (value !== "FLOAT" && value !== "PAID_IN" && value !== "PAID_OUT") {
    throw new HttpError(400, "type must be FLOAT, PAID_IN, or PAID_OUT", "INVALID_CASH_MOVEMENT");
  }

  if (value === "FLOAT") {
    return "FLOAT_IN";
  }
  return value;
};

const toApiMovementType = (value: CashMovementType):
  | "FLOAT"
  | "PAID_IN"
  | "PAID_OUT"
  | "CASH_SALE"
  | "CASH_REFUND" => {
  if (value === "FLOAT_IN") {
    return "FLOAT";
  }
  return value;
};

const ensureOpenSessionForMovementTx = async (
  tx: Prisma.TransactionClient,
  input: {
    dbType: CashMovementType;
    createdByStaffId?: string;
  },
) => {
  const open = await tx.cashSession.findFirst({
    where: { status: CashSessionStatus.OPEN },
    orderBy: [{ openedAt: "desc" }],
  });
  if (open) {
    return {
      session: open,
      autoOpened: false,
    };
  }

  if (input.dbType !== "FLOAT_IN") {
    throw new HttpError(
      409,
      "No open cash session. Record FLOAT first or open a till session",
      "CASH_SESSION_REQUIRED",
    );
  }

  const now = new Date();
  const businessDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const created = await tx.cashSession.create({
    data: {
      businessDate,
      openingFloatPence: 0,
      status: CashSessionStatus.OPEN,
      openedByStaffId: input.createdByStaffId ?? null,
    },
  });

  return {
    session: created,
    autoOpened: true,
  };
};

const toMovementDateRangeWhere = (input: DateRangeInput) => {
  const fromValue = normalizeOptionalText(input.from);
  const toValue = normalizeOptionalText(input.to);

  const fromDate = fromValue ? toDateOrThrow(fromValue, "from") : undefined;
  const toDateExclusive = toValue ? addDays(toDateOrThrow(toValue, "to"), 1) : undefined;

  if (fromDate && toDateExclusive && fromDate >= toDateExclusive) {
    throw new HttpError(400, "from must be before or equal to to", "INVALID_DATE_RANGE");
  }

  return {
    ...(fromDate || toDateExclusive
      ? {
          createdAt: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDateExclusive ? { lt: toDateExclusive } : {}),
          },
        }
      : {}),
  };
};

export const createCashMovement = async (input: CreateCashMovementInput) => {
  const dbType = toDbMovementTypeOrThrow(input.type);

  if (!Number.isInteger(input.amountPence) || (input.amountPence ?? 0) <= 0) {
    throw new HttpError(400, "amountPence must be a positive integer", "INVALID_CASH_MOVEMENT");
  }
  const amountPence = input.amountPence as number;

  const locationId = normalizeOptionalText(input.locationId) ?? DEFAULT_CASH_LOCATION_ID;
  const note = normalizeOptionalText(input.note) ?? null;
  const createdByStaffId = normalizeOptionalText(input.createdByStaffId);

  return prisma.$transaction(async (tx) => {
    const { session, autoOpened } = await ensureOpenSessionForMovementTx(tx, {
      dbType,
      createdByStaffId,
    });

    const movement = await tx.cashMovement.create({
      data: {
        sessionId: session.id,
        locationId,
        type: dbType,
        amountPence,
        ref: `MANUAL:${dbType}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        note,
        createdByStaffId: createdByStaffId ?? null,
      },
    });

    return {
      movement: {
        id: movement.id,
        sessionId: movement.sessionId,
        locationId: movement.locationId,
        type: toApiMovementType(movement.type),
        dbType: movement.type,
        reason: movement.reason,
        amountPence: movement.amountPence,
        note: movement.note,
        ref: movement.ref,
        receiptImageUrl: movement.receiptImageUrl,
        relatedSaleId: movement.relatedSaleId,
        relatedRefundId: movement.relatedRefundId,
        createdAt: movement.createdAt,
        createdByStaffId: movement.createdByStaffId,
      },
      autoOpenedSession: autoOpened,
    };
  });
};

export const listCashMovements = async (input: DateRangeInput = {}) => {
  const where = toMovementDateRangeWhere(input);

  const movements = await prisma.cashMovement.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
  });

  return {
    movements: movements.map((movement) => ({
      id: movement.id,
      sessionId: movement.sessionId,
      locationId: movement.locationId,
      type: toApiMovementType(movement.type),
      dbType: movement.type,
      reason: movement.reason,
      amountPence: movement.amountPence,
      note: movement.note,
      ref: movement.ref,
      receiptImageUrl: movement.receiptImageUrl,
      relatedSaleId: movement.relatedSaleId,
      relatedRefundId: movement.relatedRefundId,
      createdAt: movement.createdAt,
      createdByStaffId: movement.createdByStaffId,
    })),
  };
};

export const getCashSummary = async (input: DateRangeInput = {}) => {
  const where = toMovementDateRangeWhere(input);

  const rows = await prisma.cashMovement.groupBy({
    by: ["type"],
    where,
    _sum: {
      amountPence: true,
    },
  });

  const totals = {
    floatPence: 0,
    paidInPence: 0,
    paidOutPence: 0,
    cashSalesPence: 0,
    cashRefundsPence: 0,
  };

  for (const row of rows) {
    const amount = row._sum.amountPence ?? 0;
    switch (row.type) {
      case "FLOAT_IN":
        totals.floatPence += amount;
        break;
      case "PAID_IN":
        totals.paidInPence += amount;
        break;
      case "PAID_OUT":
        totals.paidOutPence += amount;
        break;
      case "CASH_SALE":
        totals.cashSalesPence += amount;
        break;
      case "CASH_REFUND":
        totals.cashRefundsPence += amount;
        break;
    }
  }

  const expectedCashOnHandPence =
    totals.floatPence +
    totals.paidInPence -
    totals.paidOutPence +
    totals.cashSalesPence -
    totals.cashRefundsPence;

  return {
    totals: {
      ...totals,
      expectedCashOnHandPence,
    },
  };
};
