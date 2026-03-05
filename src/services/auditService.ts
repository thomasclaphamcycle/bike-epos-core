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
  entityType?: string | undefined;
  entityId?: string | undefined;
  action?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
  entity?: string | undefined;
  staffId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
};

type AuditLogWriteInput = {
  staffId?: string | undefined;
  action: string;
  entity: string;
  entityId?: string | undefined;
  details?: Prisma.InputJsonValue | undefined;
};

type ListAuditLogsInput = {
  entity?: string | undefined;
  entityId?: string | undefined;
  staffId?: string | undefined;
  fromDate?: string | undefined;
  toDate?: string | undefined;
  limit?: number | undefined;
  action?: string | undefined;
};

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const normalizeText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

const parseDateOrThrow = (
  value: string,
  field: "fromDate" | "toDate",
  boundary: "start" | "end",
) => {
  if (DATE_ONLY_REGEX.test(value)) {
    return new Date(
      boundary === "start" ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`,
    );
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${field} must be a valid date`, "INVALID_DATE");
  }
  return parsed;
};

const toAuditLogCreateData = (
  input: AuditLogWriteInput,
): Prisma.AuditLogCreateInput => {
  const action = normalizeText(input.action);
  if (!action) {
    throw new HttpError(400, "action is required", "INVALID_AUDIT_LOG");
  }

  const entity = normalizeText(input.entity);
  if (!entity) {
    throw new HttpError(400, "entity is required", "INVALID_AUDIT_LOG");
  }

  const staffId = normalizeText(input.staffId);
  const entityId = normalizeText(input.entityId);

  const data: Prisma.AuditLogCreateInput = {
    action,
    entity,
  };

  if (staffId !== undefined) {
    data.staffId = staffId;
  }
  if (entityId !== undefined) {
    data.entityId = entityId;
  }
  if (input.details !== undefined) {
    data.details = input.details;
  }

  return data;
};

export const logActionTx = async (
  tx: Prisma.TransactionClient,
  input: AuditLogWriteInput,
) => {
  const data = toAuditLogCreateData(input);
  return tx.auditLog.create({ data });
};

export const logAction = async (input: AuditLogWriteInput) => {
  const data = toAuditLogCreateData(input);
  return prisma.auditLog.create({ data });
};

export const listAuditLogs = async (input: ListAuditLogsInput) => {
  const entity = normalizeText(input.entity);
  const entityId = normalizeText(input.entityId);
  const staffId = normalizeText(input.staffId);
  const action = normalizeText(input.action);
  const fromDateRaw = normalizeText(input.fromDate);
  const toDateRaw = normalizeText(input.toDate);
  const limit = parseLimitOrThrow(input.limit);

  let fromDate: Date | undefined;
  let toDate: Date | undefined;

  if (fromDateRaw) {
    fromDate = parseDateOrThrow(fromDateRaw, "fromDate", "start");
  }
  if (toDateRaw) {
    toDate = parseDateOrThrow(toDateRaw, "toDate", "end");
  }
  if (fromDate && toDate && fromDate > toDate) {
    throw new HttpError(400, "fromDate must be before or equal to toDate", "INVALID_DATE_RANGE");
  }

  const where: Prisma.AuditLogWhereInput = {};
  if (entity) {
    where.entity = entity;
  }
  if (entityId) {
    where.entityId = entityId;
  }
  if (staffId) {
    where.staffId = staffId;
  }
  if (action) {
    where.action = action;
  }
  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) {
      where.createdAt.gte = fromDate;
    }
    if (toDate) {
      where.createdAt.lte = toDate;
    }
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return {
    filters: {
      entity: entity ?? null,
      entityId: entityId ?? null,
      staffId: staffId ?? null,
      action: action ?? null,
      fromDate: fromDateRaw ?? null,
      toDate: toDateRaw ?? null,
      limit,
    },
    logs,
  };
};

export const createAuditEventTx = async (
  tx: Prisma.TransactionClient,
  input: AuditWriteInput,
  actor?: AuditActor,
) => {
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

  await tx.auditEvent.create({
    data,
  });

  await logActionTx(tx, {
    staffId: actor?.actorId,
    action: input.action,
    entity: input.entityType,
    entityId: input.entityId,
    details: input.metadata,
  });
};

export const getAuditEvents = async (input: AuditQueryInput) => {
  const entity = normalizeText(input.entityType) ?? normalizeText(input.entity);
  const entityId = normalizeText(input.entityId);
  const action = normalizeText(input.action);
  const staffId = normalizeText(input.staffId);
  const fromDate = normalizeText(input.from) ?? normalizeText(input.dateFrom);
  const toDate = normalizeText(input.to) ?? normalizeText(input.dateTo);
  const limit = parseLimitOrThrow(input.limit);

  const result = await listAuditLogs({
    entity,
    entityId,
    staffId,
    action,
    fromDate,
    toDate,
    limit,
  });

  return {
    filters: {
      entityType: result.filters.entity,
      entityId: result.filters.entityId,
      action: result.filters.action,
      from: result.filters.fromDate,
      to: result.filters.toDate,
      limit: result.filters.limit,
      entity: result.filters.entity,
      staffId: result.filters.staffId,
      dateFrom: result.filters.fromDate,
      dateTo: result.filters.toDate,
    },
    events: result.logs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entity,
      entityId: log.entityId ?? "",
      actorRole: null,
      actorId: log.staffId ?? null,
      metadata: log.details ?? null,
      createdAt: log.createdAt,
    })),
    logs: result.logs,
  };
};
