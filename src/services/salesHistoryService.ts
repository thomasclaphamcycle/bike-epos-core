import { PosSaleSource, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";

export const SALES_HISTORY_STATUS_VALUES = ["draft", "complete"] as const;
export type SalesHistoryStatus = typeof SALES_HISTORY_STATUS_VALUES[number];

export type ListSalesHistoryInput = {
  q?: string;
  statuses?: SalesHistoryStatus[];
  storeId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

type RawSalesHistoryRow = {
  id: string;
  orderNoRaw: string | null;
  status: SalesHistoryStatus;
  totalPence: number;
  soldAt: Date | string;
  customerId: string | null;
  customerName: string | null;
  workshopCustomerName: string | null;
  soldById: string | null;
  soldByName: string | null;
  soldByUsername: string | null;
  storeId: string;
  storeName: string;
  workshopJobId: string | null;
  source: PosSaleSource;
  sourceRef: string | null;
};

type RawSalesHistoryCountRow = {
  total: number | bigint;
};

const SOLD_AT_SQL = Prisma.sql`COALESCE(s."completedAt", s."createdAt")`;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

const normalizeOptionalText = (value: string | undefined | null) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseIsoDateOrThrow = (value: string, label: "dateFrom" | "dateTo") => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new HttpError(400, `${label} must be a valid ISO date`, "INVALID_SALES_HISTORY_DATE");
  }

  if (dateOnlyPattern.test(normalized)) {
    const parsed = new Date(`${normalized}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new HttpError(400, `${label} must be a valid ISO date`, "INVALID_SALES_HISTORY_DATE");
    }
    return {
      value: parsed,
      dateOnly: true,
    };
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${label} must be a valid ISO date`, "INVALID_SALES_HISTORY_DATE");
  }

  return {
    value: parsed,
    dateOnly: false,
  };
};

const buildSalesHistoryWhereSql = (input: {
  q?: string;
  statuses?: SalesHistoryStatus[];
  storeId?: string;
  dateFrom?: string;
  dateTo?: string;
}) => {
  const filters: Prisma.Sql[] = [];
  const search = normalizeOptionalText(input.q);

  if (search) {
    const pattern = `%${search}%`;
    filters.push(Prisma.sql`(
      COALESCE(r."receiptNumber", s."receiptNumber", '') ILIKE ${pattern}
      OR s.id::text ILIKE ${pattern}
      OR TRIM(CONCAT(COALESCE(c."firstName", ''), ' ', COALESCE(c."lastName", ''))) ILIKE ${pattern}
      OR COALESCE(w."customerName", '') ILIKE ${pattern}
      OR COALESCE(u."name", '') ILIKE ${pattern}
      OR COALESCE(u.username, '') ILIKE ${pattern}
    )`);
  }

  if (input.statuses && input.statuses.length > 0) {
    const statusFilters = input.statuses.map(
      (status) =>
        Prisma.sql`(CASE WHEN s."completedAt" IS NULL THEN 'draft' ELSE 'complete' END) = ${status}`,
    );
    filters.push(
      Prisma.sql`(${Prisma.join(statusFilters, " OR ")})`,
    );
  }

  const storeId = normalizeOptionalText(input.storeId);
  if (storeId) {
    filters.push(Prisma.sql`s."locationId" = ${storeId}`);
  }

  if (input.dateFrom) {
    const parsed = parseIsoDateOrThrow(input.dateFrom, "dateFrom");
    filters.push(Prisma.sql`${SOLD_AT_SQL} >= ${parsed.value}`);
  }

  if (input.dateTo) {
    const parsed = parseIsoDateOrThrow(input.dateTo, "dateTo");
    if (parsed.dateOnly) {
      const nextDay = new Date(parsed.value);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      filters.push(Prisma.sql`${SOLD_AT_SQL} < ${nextDay}`);
    } else {
      filters.push(Prisma.sql`${SOLD_AT_SQL} <= ${parsed.value}`);
    }
  }

  return filters.length > 0
    ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
    : Prisma.empty;
};

const toIsoSeconds = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
};

const toFallbackOrderNo = (id: string) => `SALE-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

const toCustomerName = (row: RawSalesHistoryRow) => {
  const directName = normalizeOptionalText(row.customerName);
  if (directName) {
    return directName;
  }

  const workshopName = normalizeOptionalText(row.workshopCustomerName);
  if (workshopName) {
    return workshopName;
  }

  return "Walk-in";
};

const toSoldByName = (row: RawSalesHistoryRow) =>
  normalizeOptionalText(row.soldByName)
  ?? normalizeOptionalText(row.soldByUsername)
  ?? "Unknown";

const toSalesHistorySource = (row: Pick<RawSalesHistoryRow, "source" | "workshopJobId">) => {
  if (row.source === PosSaleSource.WORKSHOP || (row.source === PosSaleSource.RETAIL && row.workshopJobId)) {
    return "workshop";
  }
  if (row.source === PosSaleSource.WEB) {
    return "online";
  }
  if (row.source === PosSaleSource.QUOTE) {
    return "quote";
  }
  if (row.source === PosSaleSource.EXCHANGE) {
    return "exchange";
  }
  return "pos";
};

const fromCountValue = (value: number | bigint) =>
  typeof value === "bigint" ? Number(value) : value;

export const listSalesHistory = async (input: ListSalesHistoryInput) => {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 20;
  const skip = (page - 1) * pageSize;
  const whereSql = buildSalesHistoryWhereSql(input);

  const countRows = await prisma.$queryRaw<RawSalesHistoryCountRow[]>(Prisma.sql`
    SELECT COUNT(*)::int AS total
    FROM "Sale" s
    LEFT JOIN "Receipt" r ON r."saleId" = s.id
    LEFT JOIN "Customer" c ON c.id = s."customerId"
    LEFT JOIN "app_user" u ON u.id = s."createdByStaffId"
    LEFT JOIN "WorkshopJob" w ON w.id = s."workshopJobId"
    INNER JOIN "Location" l ON l.id = s."locationId"
    ${whereSql}
  `);

  const rows = await prisma.$queryRaw<RawSalesHistoryRow[]>(Prisma.sql`
    SELECT
      s.id,
      COALESCE(r."receiptNumber", s."receiptNumber") AS "orderNoRaw",
      CASE WHEN s."completedAt" IS NULL THEN 'draft' ELSE 'complete' END AS status,
      s."totalPence" AS "totalPence",
      ${SOLD_AT_SQL} AS "soldAt",
      s."customerId" AS "customerId",
      NULLIF(TRIM(CONCAT(COALESCE(c."firstName", ''), ' ', COALESCE(c."lastName", ''))), '') AS "customerName",
      NULLIF(TRIM(COALESCE(w."customerName", '')), '') AS "workshopCustomerName",
      s."createdByStaffId" AS "soldById",
      NULLIF(TRIM(COALESCE(u."name", '')), '') AS "soldByName",
      NULLIF(TRIM(COALESCE(u.username, '')), '') AS "soldByUsername",
      l.id AS "storeId",
      l.name AS "storeName",
      s."workshopJobId" AS "workshopJobId",
      s."source" AS "source",
      s."sourceRef" AS "sourceRef"
    FROM "Sale" s
    LEFT JOIN "Receipt" r ON r."saleId" = s.id
    LEFT JOIN "Customer" c ON c.id = s."customerId"
    LEFT JOIN "app_user" u ON u.id = s."createdByStaffId"
    LEFT JOIN "WorkshopJob" w ON w.id = s."workshopJobId"
    INNER JOIN "Location" l ON l.id = s."locationId"
    ${whereSql}
    ORDER BY ${SOLD_AT_SQL} DESC, s.id DESC
    LIMIT ${pageSize}
    OFFSET ${skip}
  `);

  const total = fromCountValue(countRows[0]?.total ?? 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

  return {
    data: rows.map((row) => ({
      id: row.id,
      orderNo: normalizeOptionalText(row.orderNoRaw) ?? toFallbackOrderNo(row.id),
      type: "sale",
      status: row.status,
      total: Number((row.totalPence / 100).toFixed(2)),
      currency: "GBP",
      soldAt: toIsoSeconds(row.soldAt),
      customer: {
        id: row.customerId,
        name: toCustomerName(row),
      },
      soldBy: {
        id: row.soldById,
        name: toSoldByName(row),
      },
      store: {
        id: row.storeId,
        name: row.storeName,
      },
      reference: row.sourceRef ?? row.workshopJobId,
      source: toSalesHistorySource(row),
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  };
};
