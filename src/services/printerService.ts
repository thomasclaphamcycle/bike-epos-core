import { Prisma, RegisteredPrinterFamily, RegisteredPrinterTransportMode } from "@prisma/client";
import {
  ZEBRA_GK420D_MODEL_HINT,
  ZEBRA_LABEL_PRINTER_FAMILY,
  type PrintAgentTransportMode,
} from "../../shared/shippingPrintContract";
import { prisma } from "../lib/prisma";
import { logOperationalEvent } from "../lib/operationalLogger";
import { HttpError } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";

type PrinterClient = Prisma.TransactionClient | typeof prisma;

const DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY = "dispatch.defaultShippingLabelPrinterId";
const DEFAULT_RAW_TCP_PORT = 9100;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const printerSelect = Prisma.validator<Prisma.PrinterSelect>()({
  id: true,
  name: true,
  key: true,
  printerFamily: true,
  printerModelHint: true,
  supportsShippingLabels: true,
  isActive: true,
  transportMode: true,
  rawTcpHost: true,
  rawTcpPort: true,
  location: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
});

type PrinterRecord = Prisma.PrinterGetPayload<{ select: typeof printerSelect }>;

export type RegisteredPrinterResponse = {
  id: string;
  name: string;
  key: string;
  printerFamily: RegisteredPrinterFamily;
  printerModelHint: string;
  supportsShippingLabels: boolean;
  isActive: boolean;
  transportMode: PrintAgentTransportMode;
  rawTcpHost: string | null;
  rawTcpPort: number | null;
  location: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  isDefaultShippingLabelPrinter: boolean;
};

export type RegisteredPrinterListResponse = {
  printers: RegisteredPrinterResponse[];
  defaultShippingLabelPrinterId: string | null;
  defaultShippingLabelPrinter: RegisteredPrinterResponse | null;
};

export type RegisteredPrinterInput = {
  name?: string;
  key?: string;
  printerFamily?: string;
  printerModelHint?: string;
  supportsShippingLabels?: boolean;
  isActive?: boolean;
  transportMode?: string;
  rawTcpHost?: string | null;
  rawTcpPort?: number | null;
  location?: string | null;
  notes?: string | null;
  setAsDefaultShippingLabel?: boolean;
};

export type ResolvePrinterSelectionInput = {
  printerId?: string | null;
  printerKey?: string | null;
};

export type ResolvedShipmentPrinter = {
  id: string;
  key: string;
  name: string;
  printerFamily: typeof ZEBRA_LABEL_PRINTER_FAMILY;
  printerModelHint: typeof ZEBRA_GK420D_MODEL_HINT;
  transportMode: PrintAgentTransportMode;
  rawTcpHost: string | null;
  rawTcpPort: number | null;
  supportsShippingLabels: true;
  isActive: true;
  resolutionSource: "selected" | "default";
};

const normalizeOptionalText = (
  value: unknown,
  field: string,
  { maxLength = 160 }: { maxLength?: number } = {},
) => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be a string`, "INVALID_PRINTER");
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${field} must be ${maxLength} characters or fewer`, "INVALID_PRINTER");
  }

  return trimmed;
};

const normalizeRequiredText = (value: unknown, field: string, maxLength = 160) => {
  const normalized = normalizeOptionalText(value, field, { maxLength });
  if (!normalized) {
    throw new HttpError(400, `${field} is required`, "INVALID_PRINTER");
  }
  return normalized;
};

const normalizePrinterKey = (value: unknown) => {
  const normalized = normalizeRequiredText(value, "key", 64).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(normalized)) {
    throw new HttpError(
      400,
      "key must use letters, numbers, underscores, or hyphens",
      "INVALID_PRINTER",
    );
  }
  return normalized;
};

const normalizePrinterFamily = (value: unknown) => {
  const normalized = normalizeOptionalText(value, "printerFamily", { maxLength: 64 }) ?? ZEBRA_LABEL_PRINTER_FAMILY;
  if (normalized !== ZEBRA_LABEL_PRINTER_FAMILY) {
    throw new HttpError(
      400,
      `printerFamily must be ${ZEBRA_LABEL_PRINTER_FAMILY}`,
      "INVALID_PRINTER",
    );
  }
  return RegisteredPrinterFamily.ZEBRA_LABEL;
};

const normalizePrinterModelHint = (value: unknown) => {
  const normalized =
    normalizeOptionalText(value, "printerModelHint", { maxLength: 64 }) ?? ZEBRA_GK420D_MODEL_HINT;
  if (normalized !== ZEBRA_GK420D_MODEL_HINT) {
    throw new HttpError(
      400,
      `printerModelHint must be ${ZEBRA_GK420D_MODEL_HINT}`,
      "INVALID_PRINTER",
    );
  }
  return ZEBRA_GK420D_MODEL_HINT;
};

const normalizeBoolean = (value: unknown, field: string, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${field} must be a boolean`, "INVALID_PRINTER");
  }
  return value;
};

const normalizeTransportMode = (value: unknown, fallback: RegisteredPrinterTransportMode) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "transportMode must be a string", "INVALID_PRINTER");
  }

  const normalized = value.trim().toUpperCase();
  if (normalized !== "DRY_RUN" && normalized !== "RAW_TCP") {
    throw new HttpError(400, "transportMode must be DRY_RUN or RAW_TCP", "INVALID_PRINTER");
  }
  return normalized as RegisteredPrinterTransportMode;
};

const normalizeRawTcpHost = (value: unknown) => {
  const normalized = normalizeOptionalText(value, "rawTcpHost", { maxLength: 255 });
  if (!normalized) {
    return null;
  }
  if (/\s/.test(normalized)) {
    throw new HttpError(400, "rawTcpHost cannot contain spaces", "INVALID_PRINTER");
  }
  return normalized;
};

const normalizeRawTcpPort = (value: unknown, fallback: number) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > 65535) {
    throw new HttpError(400, "rawTcpPort must be an integer between 1 and 65535", "INVALID_PRINTER");
  }
  return Number(value);
};

const normalizeUuidOrNull = (value: Prisma.JsonValue | null) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return UUID_REGEX.test(trimmed) ? trimmed : null;
};

const parseUuid = (value: unknown, field: string, code: string) => {
  if (typeof value !== "string" || !UUID_REGEX.test(value.trim())) {
    throw new HttpError(400, `${field} must be a valid UUID`, code);
  }
  return value.trim();
};

const toPrinterResponse = (
  printer: PrinterRecord,
  defaultShippingLabelPrinterId: string | null,
): RegisteredPrinterResponse => ({
  id: printer.id,
  name: printer.name,
  key: printer.key,
  printerFamily: printer.printerFamily,
  printerModelHint: printer.printerModelHint,
  supportsShippingLabels: printer.supportsShippingLabels,
  isActive: printer.isActive,
  transportMode: printer.transportMode,
  rawTcpHost: printer.rawTcpHost ?? null,
  rawTcpPort: printer.rawTcpPort ?? null,
  location: printer.location ?? null,
  notes: printer.notes ?? null,
  createdAt: printer.createdAt,
  updatedAt: printer.updatedAt,
  isDefaultShippingLabelPrinter: printer.id === defaultShippingLabelPrinterId,
});

const getStoredDefaultShippingLabelPrinterId = async (db: PrinterClient = prisma) => {
  const row = await db.appConfig.findUnique({
    where: { key: DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY },
    select: { value: true },
  });

  return normalizeUuidOrNull(row?.value ?? null);
};

const writeDefaultShippingLabelPrinterIdTx = async (
  tx: Prisma.TransactionClient,
  printerId: string | null,
) => {
  if (!printerId) {
    await tx.appConfig.deleteMany({
      where: { key: DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY },
    });
    return;
  }

  await tx.appConfig.upsert({
    where: { key: DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY },
    create: {
      key: DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY,
      value: printerId,
    },
    update: {
      value: printerId,
    },
  });
};

const ensurePrinterCanBeDefault = (printer: PrinterRecord) => {
  if (!printer.isActive) {
    throw new HttpError(409, "Inactive printers cannot be the default shipping-label printer", "PRINTER_INACTIVE");
  }
  if (!printer.supportsShippingLabels) {
    throw new HttpError(
      409,
      "This printer does not support shipping labels",
      "PRINTER_NOT_SHIPPING_LABEL_CAPABLE",
    );
  }
};

const normalizePrinterCreateData = (input: RegisteredPrinterInput) => {
  const transportMode = normalizeTransportMode(input.transportMode, RegisteredPrinterTransportMode.DRY_RUN);
  const rawTcpHost = transportMode === "RAW_TCP" ? normalizeRawTcpHost(input.rawTcpHost) : null;
  const rawTcpPort = transportMode === "RAW_TCP"
    ? normalizeRawTcpPort(input.rawTcpPort, DEFAULT_RAW_TCP_PORT)
    : null;

  if (transportMode === "RAW_TCP" && !rawTcpHost) {
    throw new HttpError(400, "rawTcpHost is required when transportMode is RAW_TCP", "INVALID_PRINTER");
  }

  return {
    name: normalizeRequiredText(input.name, "name", 120),
    key: normalizePrinterKey(input.key),
    printerFamily: normalizePrinterFamily(input.printerFamily),
    printerModelHint: normalizePrinterModelHint(input.printerModelHint),
    supportsShippingLabels: normalizeBoolean(
      input.supportsShippingLabels,
      "supportsShippingLabels",
      true,
    ),
    isActive: normalizeBoolean(input.isActive, "isActive", true),
    transportMode,
    rawTcpHost,
    rawTcpPort,
    location: normalizeOptionalText(input.location, "location", { maxLength: 120 }),
    notes: normalizeOptionalText(input.notes, "notes", { maxLength: 400 }),
    setAsDefaultShippingLabel: input.setAsDefaultShippingLabel === true,
  };
};

const normalizePrinterPatchData = (input: RegisteredPrinterInput) => {
  if (Object.keys(input).length === 0) {
    throw new HttpError(400, "At least one printer change is required", "INVALID_PRINTER");
  }

  const data: Prisma.PrinterUpdateInput = {};

  if (input.name !== undefined) {
    data.name = normalizeRequiredText(input.name, "name", 120);
  }
  if (input.key !== undefined) {
    data.key = normalizePrinterKey(input.key);
  }
  if (input.printerFamily !== undefined) {
    data.printerFamily = normalizePrinterFamily(input.printerFamily);
  }
  if (input.printerModelHint !== undefined) {
    data.printerModelHint = normalizePrinterModelHint(input.printerModelHint);
  }
  if (input.supportsShippingLabels !== undefined) {
    data.supportsShippingLabels = normalizeBoolean(
      input.supportsShippingLabels,
      "supportsShippingLabels",
      true,
    );
  }
  if (input.isActive !== undefined) {
    data.isActive = normalizeBoolean(input.isActive, "isActive", true);
  }
  if (input.location !== undefined) {
    data.location = normalizeOptionalText(input.location, "location", { maxLength: 120 });
  }
  if (input.notes !== undefined) {
    data.notes = normalizeOptionalText(input.notes, "notes", { maxLength: 400 });
  }

  if (input.transportMode !== undefined || input.rawTcpHost !== undefined || input.rawTcpPort !== undefined) {
    const transportMode = normalizeTransportMode(
      input.transportMode,
      RegisteredPrinterTransportMode.DRY_RUN,
    );
    data.transportMode = transportMode;
    if (transportMode === "RAW_TCP") {
      const rawTcpHost = normalizeRawTcpHost(input.rawTcpHost);
      if (!rawTcpHost) {
        throw new HttpError(400, "rawTcpHost is required when transportMode is RAW_TCP", "INVALID_PRINTER");
      }
      data.rawTcpHost = rawTcpHost;
      data.rawTcpPort = normalizeRawTcpPort(input.rawTcpPort, DEFAULT_RAW_TCP_PORT);
    } else {
      data.rawTcpHost = null;
      data.rawTcpPort = null;
    }
  }

  return {
    data,
    setAsDefaultShippingLabel:
      input.setAsDefaultShippingLabel === undefined ? undefined : input.setAsDefaultShippingLabel === true,
  };
};

const getPrinterByIdOrThrow = async (printerId: string, db: PrinterClient = prisma) => {
  const normalizedPrinterId = parseUuid(printerId, "printerId", "INVALID_PRINTER_ID");
  const printer = await db.printer.findUnique({
    where: { id: normalizedPrinterId },
    select: printerSelect,
  });

  if (!printer) {
    throw new HttpError(404, "Printer not found", "PRINTER_NOT_FOUND");
  }

  return printer;
};

export const listRegisteredPrinters = async (
  input: { activeOnly?: boolean; shippingLabelOnly?: boolean } = {},
  db: PrinterClient = prisma,
): Promise<RegisteredPrinterListResponse> => {
  const where: Prisma.PrinterWhereInput = {};
  if (input.activeOnly) {
    where.isActive = true;
  }
  if (input.shippingLabelOnly) {
    where.supportsShippingLabels = true;
  }

  const [printers, defaultShippingLabelPrinterId] = await Promise.all([
    db.printer.findMany({
      where,
      select: printerSelect,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    getStoredDefaultShippingLabelPrinterId(db),
  ]);

  const mapped = printers.map((printer) => toPrinterResponse(printer, defaultShippingLabelPrinterId));
  return {
    printers: mapped,
    defaultShippingLabelPrinterId,
    defaultShippingLabelPrinter:
      mapped.find((printer) => printer.id === defaultShippingLabelPrinterId) ?? null,
  };
};

export const createRegisteredPrinter = async (
  input: RegisteredPrinterInput,
  auditActor?: AuditActor,
) => {
  const normalized = normalizePrinterCreateData(input);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.printer.create({
        data: {
          name: normalized.name,
          key: normalized.key,
          printerFamily: normalized.printerFamily,
          printerModelHint: normalized.printerModelHint,
          supportsShippingLabels: normalized.supportsShippingLabels,
          isActive: normalized.isActive,
          transportMode: normalized.transportMode,
          rawTcpHost: normalized.rawTcpHost,
          rawTcpPort: normalized.rawTcpPort,
          location: normalized.location,
          notes: normalized.notes,
        },
        select: printerSelect,
      });

      if (normalized.setAsDefaultShippingLabel) {
        ensurePrinterCanBeDefault(created);
        await writeDefaultShippingLabelPrinterIdTx(tx, created.id);
      }

      await createAuditEventTx(
        tx,
        {
          action: "PRINTER_CREATED",
          entityType: "PRINTER",
          entityId: created.id,
          metadata: {
            key: created.key,
            name: created.name,
            transportMode: created.transportMode,
            supportsShippingLabels: created.supportsShippingLabels,
            isDefaultShippingLabelPrinter: normalized.setAsDefaultShippingLabel,
          },
        },
        auditActor,
      );

      const defaultShippingLabelPrinterId = await getStoredDefaultShippingLabelPrinterId(tx);
      return {
        printer: toPrinterResponse(created, defaultShippingLabelPrinterId),
        defaultShippingLabelPrinterId,
      };
    });

    logOperationalEvent("dispatch.printer.created", {
      entityId: result.printer.id,
      printerKey: result.printer.key,
      transportMode: result.printer.transportMode,
    });

    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "Printer key already exists", "PRINTER_KEY_CONFLICT");
    }
    throw error;
  }
};

export const updateRegisteredPrinter = async (
  printerId: string,
  input: RegisteredPrinterInput,
  auditActor?: AuditActor,
) => {
  const normalizedPrinterId = parseUuid(printerId, "printerId", "INVALID_PRINTER_ID");
  const normalized = normalizePrinterPatchData(input);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await getPrinterByIdOrThrow(normalizedPrinterId, tx);
      const saved = await tx.printer.update({
        where: { id: existing.id },
        data: normalized.data,
        select: printerSelect,
      });

      const defaultShippingLabelPrinterId = await getStoredDefaultShippingLabelPrinterId(tx);
      const shouldClearDefault =
        defaultShippingLabelPrinterId === saved.id && (!saved.isActive || !saved.supportsShippingLabels);
      if (shouldClearDefault) {
        await writeDefaultShippingLabelPrinterIdTx(tx, null);
      } else if (normalized.setAsDefaultShippingLabel === true) {
        ensurePrinterCanBeDefault(saved);
        await writeDefaultShippingLabelPrinterIdTx(tx, saved.id);
      } else if (normalized.setAsDefaultShippingLabel === false && defaultShippingLabelPrinterId === saved.id) {
        await writeDefaultShippingLabelPrinterIdTx(tx, null);
      }

      const updatedDefaultShippingLabelPrinterId = await getStoredDefaultShippingLabelPrinterId(tx);

      await createAuditEventTx(
        tx,
        {
          action: "PRINTER_UPDATED",
          entityType: "PRINTER",
          entityId: saved.id,
          metadata: {
            key: saved.key,
            name: saved.name,
            transportMode: saved.transportMode,
            supportsShippingLabels: saved.supportsShippingLabels,
            isActive: saved.isActive,
            defaultShippingLabelPrinterId: updatedDefaultShippingLabelPrinterId,
          },
        },
        auditActor,
      );

      return {
        printer: toPrinterResponse(saved, updatedDefaultShippingLabelPrinterId),
        defaultShippingLabelPrinterId: updatedDefaultShippingLabelPrinterId,
      };
    });

    logOperationalEvent("dispatch.printer.updated", {
      entityId: result.printer.id,
      printerKey: result.printer.key,
      transportMode: result.printer.transportMode,
    });

    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "Printer key already exists", "PRINTER_KEY_CONFLICT");
    }
    throw error;
  }
};

export const setDefaultShippingLabelPrinter = async (
  printerId: string | null,
  auditActor?: AuditActor,
) => {
  const normalizedPrinterId = printerId ? parseUuid(printerId, "printerId", "INVALID_PRINTER_ID") : null;

  const result = await prisma.$transaction(async (tx) => {
    let printer: PrinterRecord | null = null;
    if (normalizedPrinterId) {
      printer = await getPrinterByIdOrThrow(normalizedPrinterId, tx);
      ensurePrinterCanBeDefault(printer);
    }

    await writeDefaultShippingLabelPrinterIdTx(tx, normalizedPrinterId);

    await createAuditEventTx(
      tx,
      {
        action: normalizedPrinterId
          ? "DEFAULT_SHIPPING_LABEL_PRINTER_SET"
          : "DEFAULT_SHIPPING_LABEL_PRINTER_CLEARED",
        entityType: "APP_CONFIG",
        entityId: DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY,
        metadata: {
          printerId: normalizedPrinterId,
          printerKey: printer?.key ?? null,
          printerName: printer?.name ?? null,
        },
      },
      auditActor,
    );

    const defaultShippingLabelPrinterId = await getStoredDefaultShippingLabelPrinterId(tx);
    return {
      defaultShippingLabelPrinterId,
      defaultShippingLabelPrinter:
        printer && defaultShippingLabelPrinterId === printer.id
          ? toPrinterResponse(printer, defaultShippingLabelPrinterId)
          : null,
    };
  });

  logOperationalEvent("dispatch.printer.default_updated", {
    entityId: result.defaultShippingLabelPrinterId ?? DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY,
    printerId: result.defaultShippingLabelPrinterId,
  });

  return result;
};

export const resolveShipmentLabelPrinterSelection = async (
  input: ResolvePrinterSelectionInput = {},
  db: PrinterClient = prisma,
): Promise<ResolvedShipmentPrinter> => {
  const normalizedPrinterId =
    input.printerId === undefined || input.printerId === null || input.printerId === ""
      ? null
      : parseUuid(input.printerId, "printerId", "INVALID_PRINTER_ID");
  const normalizedPrinterKey =
    input.printerKey === undefined || input.printerKey === null || String(input.printerKey).trim().length === 0
      ? null
      : normalizePrinterKey(input.printerKey);

  let printer: PrinterRecord | null = null;
  let resolutionSource: "selected" | "default" = "selected";

  if (normalizedPrinterId) {
    printer = await db.printer.findUnique({
      where: { id: normalizedPrinterId },
      select: printerSelect,
    });
  } else if (normalizedPrinterKey) {
    printer = await db.printer.findUnique({
      where: { key: normalizedPrinterKey },
      select: printerSelect,
    });
  } else {
    resolutionSource = "default";
    const defaultPrinterId = await getStoredDefaultShippingLabelPrinterId(db);
    if (!defaultPrinterId) {
      throw new HttpError(
        409,
        "No default shipping-label printer is configured. Set one in Settings or choose a registered printer.",
        "DEFAULT_SHIPPING_LABEL_PRINTER_NOT_CONFIGURED",
      );
    }
    printer = await db.printer.findUnique({
      where: { id: defaultPrinterId },
      select: printerSelect,
    });
  }

  if (!printer) {
    throw new HttpError(404, "Registered printer not found", "PRINTER_NOT_FOUND");
  }
  if (!printer.isActive) {
    throw new HttpError(409, "This printer is inactive and cannot be used", "PRINTER_INACTIVE");
  }
  if (!printer.supportsShippingLabels) {
    throw new HttpError(
      409,
      "This printer is not configured for shipping labels",
      "PRINTER_NOT_SHIPPING_LABEL_CAPABLE",
    );
  }
  if (printer.printerFamily !== RegisteredPrinterFamily.ZEBRA_LABEL) {
    throw new HttpError(
      409,
      "Only Zebra-style shipping label printers are supported in this flow",
      "PRINTER_FAMILY_NOT_SUPPORTED",
    );
  }
  if (printer.printerModelHint !== ZEBRA_GK420D_MODEL_HINT) {
    throw new HttpError(
      409,
      "Only GK420d-compatible printer model hints are supported in this flow",
      "PRINTER_MODEL_NOT_SUPPORTED",
    );
  }
  if (printer.transportMode === RegisteredPrinterTransportMode.RAW_TCP && !printer.rawTcpHost) {
    throw new HttpError(
      409,
      "This RAW_TCP printer is missing its host configuration",
      "PRINTER_TARGET_MISCONFIGURED",
    );
  }

  return {
    id: printer.id,
    key: printer.key,
    name: printer.name,
    printerFamily: ZEBRA_LABEL_PRINTER_FAMILY,
    printerModelHint: ZEBRA_GK420D_MODEL_HINT,
    transportMode: printer.transportMode,
    rawTcpHost: printer.rawTcpHost ?? null,
    rawTcpPort: printer.transportMode === RegisteredPrinterTransportMode.RAW_TCP
      ? printer.rawTcpPort ?? DEFAULT_RAW_TCP_PORT
      : null,
    supportsShippingLabels: true,
    isActive: true,
    resolutionSource,
  };
};
