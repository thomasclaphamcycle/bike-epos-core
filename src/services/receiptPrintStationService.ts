import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";

type ReceiptPrintStationClient = Prisma.TransactionClient | typeof prisma;

type StoredReceiptPrintStationDefaults = {
  printerIdsByStationKey: Record<string, string | null>;
  updatedAt: string;
};

export const RECEIPT_WORKSTATION_OPTIONS = [
  {
    key: "TILL_PC",
    label: "Till PC",
    description: "Main retail till. Defaults to the till-facing receipt printer.",
  },
  {
    key: "WORKSHOP_1",
    label: "Workshop 1",
    description: "Workshop bench one. Defaults to the workshop receipt printer.",
  },
  {
    key: "WORKSHOP_2",
    label: "Workshop 2 / Dymo PC",
    description: "Flexible workshop station. Can default to either receipt printer and override when needed.",
  },
] as const;

export type ReceiptWorkstationKey = typeof RECEIPT_WORKSTATION_OPTIONS[number]["key"];

export type ReceiptPrintWorkstation = {
  key: ReceiptWorkstationKey;
  label: string;
  description: string;
  defaultPrinterId: string | null;
};

export type ReceiptPrintStationSettingsResponse = {
  updatedAt: string | null;
  workstations: ReceiptPrintWorkstation[];
};

export type ReceiptPrintStationSettingsInput = {
  workstations: Array<{
    key: string;
    defaultPrinterId?: string | null;
  }>;
};

const RECEIPT_PRINT_STATIONS_CONFIG_KEY = "receipts.workstationDefaults";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isReceiptWorkstationKey = (value: string): value is ReceiptWorkstationKey =>
  RECEIPT_WORKSTATION_OPTIONS.some((option) => option.key === value);

const normalizeUuidOrNull = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !UUID_REGEX.test(value.trim())) {
    throw new HttpError(400, `${field} must be a UUID or null`, "INVALID_RECEIPT_WORKSTATION_SETTINGS");
  }
  return value.trim();
};

const parseStoredConfig = (value: Prisma.JsonValue | null): StoredReceiptPrintStationDefaults | null => {
  if (!isRecord(value)) {
    return null;
  }

  const rawMap = isRecord(value.printerIdsByStationKey) ? value.printerIdsByStationKey : {};
  const printerIdsByStationKey = Object.fromEntries(
    RECEIPT_WORKSTATION_OPTIONS.map((option) => {
      const rawPrinterId = rawMap[option.key];
      return [
        option.key,
        typeof rawPrinterId === "string" && UUID_REGEX.test(rawPrinterId.trim()) ? rawPrinterId.trim() : null,
      ];
    }),
  );

  return {
    printerIdsByStationKey,
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt.trim().length > 0
        ? value.updatedAt.trim()
        : new Date(0).toISOString(),
  };
};

const getStoredReceiptPrintStationDefaults = async (
  db: ReceiptPrintStationClient = prisma,
): Promise<StoredReceiptPrintStationDefaults | null> => {
  const row = await db.appConfig.findUnique({
    where: { key: RECEIPT_PRINT_STATIONS_CONFIG_KEY },
    select: { value: true },
  });

  return parseStoredConfig(row?.value ?? null);
};

const toResponse = (
  stored: StoredReceiptPrintStationDefaults | null,
): ReceiptPrintStationSettingsResponse => ({
  updatedAt: stored?.updatedAt ?? null,
  workstations: RECEIPT_WORKSTATION_OPTIONS.map((option) => ({
    ...option,
    defaultPrinterId: stored?.printerIdsByStationKey[option.key] ?? null,
  })),
});

export const listReceiptPrintStations = async (): Promise<ReceiptPrintStationSettingsResponse> => {
  const stored = await getStoredReceiptPrintStationDefaults();
  return toResponse(stored);
};

export const resolveReceiptPrintWorkstation = async (
  key: string | null | undefined,
  db: ReceiptPrintStationClient = prisma,
): Promise<ReceiptPrintWorkstation | null> => {
  const normalizedKey = typeof key === "string" ? key.trim().toUpperCase() : "";
  if (!normalizedKey || !isReceiptWorkstationKey(normalizedKey)) {
    return null;
  }

  const stored = await getStoredReceiptPrintStationDefaults(db);
  const option = RECEIPT_WORKSTATION_OPTIONS.find((entry) => entry.key === normalizedKey);
  if (!option) {
    return null;
  }

  return {
    ...option,
    defaultPrinterId: stored?.printerIdsByStationKey[normalizedKey] ?? null,
  };
};

export const updateReceiptPrintStations = async (
  input: ReceiptPrintStationSettingsInput,
  actor?: AuditActor,
): Promise<ReceiptPrintStationSettingsResponse> => {
  if (!input || typeof input !== "object" || !Array.isArray(input.workstations)) {
    throw new HttpError(
      400,
      "workstations must be an array",
      "INVALID_RECEIPT_WORKSTATION_SETTINGS",
    );
  }

  const printerIdsByStationKey = Object.fromEntries(
    RECEIPT_WORKSTATION_OPTIONS.map((option) => [option.key, null as string | null]),
  ) as Record<ReceiptWorkstationKey, string | null>;

  for (const entry of input.workstations) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new HttpError(400, "Each workstation entry must be an object", "INVALID_RECEIPT_WORKSTATION_SETTINGS");
    }
    if (typeof entry.key !== "string") {
      throw new HttpError(400, "workstation key must be a string", "INVALID_RECEIPT_WORKSTATION_SETTINGS");
    }
    const normalizedKey = entry.key.trim().toUpperCase();
    if (!isReceiptWorkstationKey(normalizedKey)) {
      throw new HttpError(
        400,
        `Unknown receipt workstation ${entry.key}`,
        "INVALID_RECEIPT_WORKSTATION_SETTINGS",
      );
    }

    printerIdsByStationKey[normalizedKey] = normalizeUuidOrNull(
      entry.defaultPrinterId,
      `${normalizedKey}.defaultPrinterId`,
    );
  }

  const nextConfig: StoredReceiptPrintStationDefaults = {
    printerIdsByStationKey,
    updatedAt: new Date().toISOString(),
  };

  const response = await prisma.$transaction(async (tx) => {
    await tx.appConfig.upsert({
      where: { key: RECEIPT_PRINT_STATIONS_CONFIG_KEY },
      create: {
        key: RECEIPT_PRINT_STATIONS_CONFIG_KEY,
        value: nextConfig as unknown as Prisma.InputJsonValue,
      },
      update: {
        value: nextConfig as unknown as Prisma.InputJsonValue,
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "RECEIPT_PRINT_STATIONS_UPDATED",
        entityType: "APP_CONFIG",
        entityId: RECEIPT_PRINT_STATIONS_CONFIG_KEY,
        metadata: {
          workstations: RECEIPT_WORKSTATION_OPTIONS.map((option) => ({
            key: option.key,
            defaultPrinterId: printerIdsByStationKey[option.key],
          })),
        },
      },
      actor,
    );

    return toResponse(nextConfig);
  });

  return response;
};
