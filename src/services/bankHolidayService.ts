import { AppConfig, Prisma, RotaClosedDayType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";

type BankHolidayClient = Prisma.TransactionClient | typeof prisma;

type GovUkDivisionKey = "england-and-wales";

type GovUkBankHolidayEvent = {
  title: string;
  date: string;
  notes?: string;
  bunting?: boolean;
};

type GovUkBankHolidayDivision = {
  division: string;
  events: GovUkBankHolidayEvent[];
};

type GovUkBankHolidayResponse = Record<string, GovUkBankHolidayDivision>;

type BankHolidaySyncMetadata = {
  region: GovUkDivisionKey;
  sourceUrl: string;
  lastSyncedAt: string;
  lastSyncedByStaffId: string | null;
  lastResult: {
    createdCount: number;
    updatedCount: number;
    removedCount: number;
    unchangedCount: number;
    skippedManualCount: number;
    warningCount: number;
  };
};

type BankHolidaySyncInput = {
  feedUrl?: string;
  syncedByStaffId?: string;
};

export type BankHolidaySyncStatus = {
  region: GovUkDivisionKey;
  sourceUrl: string;
  lastSyncedAt: string | null;
  lastSyncedByStaffId: string | null;
  lastResult: BankHolidaySyncMetadata["lastResult"] | null;
  storedCount: number;
  upcoming: Array<{
    date: string;
    name: string;
  }>;
};

export type BankHolidaySyncResult = BankHolidaySyncStatus & {
  warnings: string[];
};

const GOV_UK_BANK_HOLIDAY_FEED_URL = "https://www.gov.uk/bank-holidays.json";
const BANK_HOLIDAY_REGION: GovUkDivisionKey = "england-and-wales";
const BANK_HOLIDAY_STATUS_KEY = "rota.bankHolidaySync";
const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const normalizeFeedUrl = (value: string | undefined) => {
  const normalized = value?.trim();
  if (!normalized) {
    return process.env.BANK_HOLIDAY_FEED_URL?.trim() || GOV_UK_BANK_HOLIDAY_FEED_URL;
  }
  return normalized;
};

const isValidDateKey = (value: string) => {
  if (!DATE_KEY_REGEX.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const normalizeBankHolidayEvent = (value: GovUkBankHolidayEvent) => {
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const date = typeof value.date === "string" ? value.date.trim() : "";
  if (!title || !date || !isValidDateKey(date)) {
    return null;
  }

  return {
    title,
    date,
  };
};

const parseGovUkDivision = (payload: unknown, region: GovUkDivisionKey) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(502, "Bank holiday feed returned an invalid response.", "BANK_HOLIDAY_SYNC_FAILED");
  }

  const division = (payload as GovUkBankHolidayResponse)[region];
  if (!division || typeof division !== "object" || !Array.isArray(division.events)) {
    throw new HttpError(502, "Bank holiday feed is missing the required UK region.", "BANK_HOLIDAY_SYNC_FAILED");
  }

  const events = division.events
    .map(normalizeBankHolidayEvent)
    .filter((event): event is NonNullable<typeof event> => Boolean(event))
    .sort((left, right) => left.date.localeCompare(right.date));

  if (!events.length) {
    throw new HttpError(502, "Bank holiday feed returned no usable events.", "BANK_HOLIDAY_SYNC_FAILED");
  }

  return events;
};

const buildStatusFromState = (
  storedBankHolidays: Array<{ date: string; note: string | null }>,
  metadata: BankHolidaySyncMetadata | null,
): BankHolidaySyncStatus => ({
  region: BANK_HOLIDAY_REGION,
  sourceUrl: metadata?.sourceUrl ?? normalizeFeedUrl(undefined),
  lastSyncedAt: metadata?.lastSyncedAt ?? null,
  lastSyncedByStaffId: metadata?.lastSyncedByStaffId ?? null,
  lastResult: metadata?.lastResult ?? null,
  storedCount: storedBankHolidays.length,
  upcoming: storedBankHolidays.slice(0, 6).map((closedDay) => ({
    date: closedDay.date,
    name: closedDay.note?.trim() || "Bank holiday",
  })),
});

const fetchGovUkBankHolidays = async (
  feedUrl: string,
  region: GovUkDivisionKey,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(feedUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new HttpError(
        502,
        `Bank holiday feed request failed (${response.status}).`,
        "BANK_HOLIDAY_SYNC_FAILED",
      );
    }

    const payload = await response.json();
    return parseGovUkDivision(payload, region);
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(502, "Failed to fetch the GOV.UK bank holiday feed.", "BANK_HOLIDAY_SYNC_FAILED");
  } finally {
    clearTimeout(timeout);
  }
};

const parseStoredMetadata = (config: AppConfig | null): BankHolidaySyncMetadata | null => {
  if (!config || !config.value || typeof config.value !== "object" || Array.isArray(config.value)) {
    return null;
  }

  const record = config.value as Record<string, unknown>;
  const lastResult = record.lastResult;
  if (
    typeof record.lastSyncedAt !== "string"
    || typeof record.sourceUrl !== "string"
    || typeof record.region !== "string"
    || !lastResult
    || typeof lastResult !== "object"
    || Array.isArray(lastResult)
  ) {
    return null;
  }

  const resultRecord = lastResult as Record<string, unknown>;
  return {
    region: record.region === BANK_HOLIDAY_REGION ? BANK_HOLIDAY_REGION : BANK_HOLIDAY_REGION,
    sourceUrl: record.sourceUrl,
    lastSyncedAt: record.lastSyncedAt,
    lastSyncedByStaffId: typeof record.lastSyncedByStaffId === "string" ? record.lastSyncedByStaffId : null,
    lastResult: {
      createdCount: Number(resultRecord.createdCount ?? 0) || 0,
      updatedCount: Number(resultRecord.updatedCount ?? 0) || 0,
      removedCount: Number(resultRecord.removedCount ?? 0) || 0,
      unchangedCount: Number(resultRecord.unchangedCount ?? 0) || 0,
      skippedManualCount: Number(resultRecord.skippedManualCount ?? 0) || 0,
      warningCount: Number(resultRecord.warningCount ?? 0) || 0,
    },
  };
};

const listStoredBankHolidays = async (db: BankHolidayClient) => {
  const today = new Date().toISOString().slice(0, 10);
  return db.rotaClosedDay.findMany({
    where: {
      type: RotaClosedDayType.BANK_HOLIDAY,
      date: {
        gte: today,
      },
    },
    orderBy: {
      date: "asc",
    },
    select: {
      date: true,
      note: true,
    },
  });
};

export const getBankHolidaySyncStatus = async (
  db: BankHolidayClient = prisma,
): Promise<BankHolidaySyncStatus> => {
  const [config, storedBankHolidays] = await Promise.all([
    db.appConfig.findUnique({
      where: { key: BANK_HOLIDAY_STATUS_KEY },
    }),
    listStoredBankHolidays(db),
  ]);

  return buildStatusFromState(storedBankHolidays, parseStoredMetadata(config));
};

export const syncUkBankHolidays = async (
  input: BankHolidaySyncInput = {},
  db: typeof prisma = prisma,
): Promise<BankHolidaySyncResult> => {
  const sourceUrl = normalizeFeedUrl(input.feedUrl);
  const events = await fetchGovUkBankHolidays(sourceUrl, BANK_HOLIDAY_REGION);

  const eventMap = new Map<string, string>();
  for (const event of events) {
    eventMap.set(event.date, event.title);
  }

  const warnings: string[] = [];

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.rotaClosedDay.findMany({
      where: {
        OR: [
          {
            type: RotaClosedDayType.BANK_HOLIDAY,
          },
          {
            date: {
              in: [...eventMap.keys()],
            },
          },
        ],
      },
      select: {
        id: true,
        date: true,
        type: true,
        note: true,
      },
    });

    const existingByDate = new Map(existing.map((closedDay) => [closedDay.date, closedDay]));
    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let skippedManualCount = 0;

    for (const [date, title] of eventMap.entries()) {
      const existingClosedDay = existingByDate.get(date);
      if (existingClosedDay && existingClosedDay.type !== RotaClosedDayType.BANK_HOLIDAY) {
        skippedManualCount += 1;
        warnings.push(`Skipped ${date} (${title}) because a non-bank-holiday closed day already exists.`);
        continue;
      }

      if (!existingClosedDay) {
        await tx.rotaClosedDay.create({
          data: {
            date,
            type: RotaClosedDayType.BANK_HOLIDAY,
            note: title,
          },
        });
        createdCount += 1;
        continue;
      }

      if ((existingClosedDay.note?.trim() || "") === title) {
        unchangedCount += 1;
        continue;
      }

      await tx.rotaClosedDay.update({
        where: {
          id: existingClosedDay.id,
        },
        data: {
          note: title,
        },
      });
      updatedCount += 1;
    }

    const removableBankHolidayIds = existing
      .filter((closedDay) => closedDay.type === RotaClosedDayType.BANK_HOLIDAY && !eventMap.has(closedDay.date))
      .map((closedDay) => closedDay.id);

    if (removableBankHolidayIds.length) {
      await tx.rotaClosedDay.deleteMany({
        where: {
          id: {
            in: removableBankHolidayIds,
          },
        },
      });
    }

    const metadata: BankHolidaySyncMetadata = {
      region: BANK_HOLIDAY_REGION,
      sourceUrl,
      lastSyncedAt: new Date().toISOString(),
      lastSyncedByStaffId: input.syncedByStaffId?.trim() || null,
      lastResult: {
        createdCount,
        updatedCount,
        removedCount: removableBankHolidayIds.length,
        unchangedCount,
        skippedManualCount,
        warningCount: warnings.length,
      },
    };

    await tx.appConfig.upsert({
      where: { key: BANK_HOLIDAY_STATUS_KEY },
      update: {
        value: metadata,
      },
      create: {
        key: BANK_HOLIDAY_STATUS_KEY,
        value: metadata,
      },
    });

    const storedBankHolidays = await listStoredBankHolidays(tx);
    return {
      status: buildStatusFromState(storedBankHolidays, metadata),
      warnings,
    };
  });

  return {
    ...result.status,
    warnings: result.warnings,
  };
};
