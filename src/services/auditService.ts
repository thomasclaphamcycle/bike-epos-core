import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";

export type AuditActor = {
  role?: string;
  actorId?: string;
};

type AuditWriteInput = {
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
};

type AuditQueryInput = {
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
};

const toAuditEventCreateInput = (
  input: AuditWriteInput,
  actor?: AuditActor,
): Prisma.AuditEventCreateInput => {
  const data: Prisma.AuditEventCreateInput = {
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
  };

  if (actor?.role !== undefined) {
    data.actorRole = actor.role;
  }

  if (actor?.actorId !== undefined) {
    data.actorId = actor.actorId;
  }

  if (input.metadata !== undefined) {
    data.metadata = input.metadata;
  }

  return data;
};

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const normalizeText = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseDateOnlyOrThrow = (value: string, field: "from" | "to") => {
  if (!DATE_ONLY_REGEX.test(value)) {
    throw new HttpError(400, `${field} must be YYYY-MM-DD`, "INVALID_DATE");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${field} is invalid`, "INVALID_DATE");
  }
  return date;
};

const addDays = (date: Date, days: number) => {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
};

const parseLimitOrThrow = (value: number | undefined) => {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }

  if (!Number.isInteger(value) || value <= 0 || value > MAX_LIMIT) {
    throw new HttpError(
      400,
      `limit must be an integer between 1 and ${MAX_LIMIT}`,
      "INVALID_FILTER",
    );
  }

  return value;
};

export const createAuditEventTx = async (
  tx: Prisma.TransactionClient,
  input: AuditWriteInput,
  actor?: AuditActor,
) => {
  await tx.auditEvent.create({
    data: toAuditEventCreateInput(input, actor),
  });
};

export const createAuditEvent = async (
  input: AuditWriteInput,
  actor?: AuditActor,
) => {
  await prisma.auditEvent.create({
    data: toAuditEventCreateInput(input, actor),
  });
};

export const getAuditEvents = async (input: AuditQueryInput) => {
  const entityType = normalizeText(input.entityType);
  const entityId = normalizeText(input.entityId);
  const action = normalizeText(input.action);
  const from = normalizeText(input.from);
  const to = normalizeText(input.to);
  const limit = parseLimitOrThrow(input.limit);

  let fromDate: Date | undefined;
  let toDateExclusive: Date | undefined;

  if (from) {
    fromDate = parseDateOnlyOrThrow(from, "from");
  }
  if (to) {
    const toDate = parseDateOnlyOrThrow(to, "to");
    toDateExclusive = addDays(toDate, 1);
  }

  if (fromDate && toDateExclusive && fromDate >= toDateExclusive) {
    throw new HttpError(400, "from must be before or equal to to", "INVALID_DATE_RANGE");
  }

  const where: Prisma.AuditEventWhereInput = {};

  if (entityType) {
    where.entityType = entityType;
  }
  if (entityId) {
    where.entityId = entityId;
  }
  if (action) {
    where.action = action;
  }
  if (fromDate || toDateExclusive) {
    where.createdAt = {};
    if (fromDate) {
      where.createdAt.gte = fromDate;
    }
    if (toDateExclusive) {
      where.createdAt.lt = toDateExclusive;
    }
  }

  const events = await prisma.auditEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return {
    filters: {
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      action: action ?? null,
      from: from ?? null,
      to: to ?? null,
      limit,
    },
    events,
  };
};
