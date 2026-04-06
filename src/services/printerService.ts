import { Prisma, RegisteredPrinterFamily, RegisteredPrinterTransportMode } from "@prisma/client";
import {
  DYMO_57X32_MODEL_HINT,
  DYMO_LABEL_PRINTER_FAMILY,
  type ProductLabelPrintTransportMode,
} from "../../shared/productLabelPrintContract";
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
type RegisteredPrinterTransportModeValue = "DRY_RUN" | "RAW_TCP" | "WINDOWS_PRINTER";
type DefaultPrinterConfigKey =
  | typeof DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY
  | typeof DEFAULT_PRODUCT_LABEL_PRINTER_CONFIG_KEY;

const DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY = "dispatch.defaultShippingLabelPrinterId";
const DEFAULT_PRODUCT_LABEL_PRINTER_CONFIG_KEY = "labels.defaultProductLabelPrinterId";
const DEFAULT_RAW_TCP_PORT = 9100;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const printerSelect = Prisma.validator<Prisma.PrinterSelect>()({
  id: true,
  name: true,
  key: true,
  printerFamily: true,
  printerModelHint: true,
  supportsShippingLabels: true,
  supportsProductLabels: true,
  isActive: true,
  transportMode: true,
  windowsPrinterName: true,
  rawTcpHost: true,
  rawTcpPort: true,
  location: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
});

type PrinterRecord = Prisma.PrinterGetPayload<{ select: typeof printerSelect }>;

type StoredPrinterDefaults = {
  defaultShippingLabelPrinterId: string | null;
  defaultProductLabelPrinterId: string | null;
};

export type RegisteredPrinterResponse = {
  id: string;
  name: string;
  key: string;
  printerFamily: RegisteredPrinterFamily;
  printerModelHint: string;
  supportsShippingLabels: boolean;
  supportsProductLabels: boolean;
  isActive: boolean;
  transportMode: RegisteredPrinterTransportModeValue;
  windowsPrinterName: string | null;
  rawTcpHost: string | null;
  rawTcpPort: number | null;
  location: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  isDefaultShippingLabelPrinter: boolean;
  isDefaultProductLabelPrinter: boolean;
};

export type RegisteredPrinterListResponse = {
  printers: RegisteredPrinterResponse[];
  defaultShippingLabelPrinterId: string | null;
  defaultShippingLabelPrinter: RegisteredPrinterResponse | null;
  defaultProductLabelPrinterId: string | null;
  defaultProductLabelPrinter: RegisteredPrinterResponse | null;
};

export type RegisteredPrinterInput = {
  name?: string;
  key?: string;
  printerFamily?: string;
  printerModelHint?: string;
  supportsShippingLabels?: boolean;
  supportsProductLabels?: boolean;
  isActive?: boolean;
  transportMode?: string;
  windowsPrinterName?: string | null;
  rawTcpHost?: string | null;
  rawTcpPort?: number | null;
  location?: string | null;
  notes?: string | null;
  setAsDefaultShippingLabel?: boolean;
  setAsDefaultProductLabel?: boolean;
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
  windowsPrinterName: string | null;
  rawTcpHost: string | null;
  rawTcpPort: number | null;
  supportsShippingLabels: true;
  isActive: true;
  resolutionSource: "selected" | "default";
};

export type ResolvedProductLabelPrinter = {
  id: string;
  key: string;
  name: string;
  printerFamily: typeof DYMO_LABEL_PRINTER_FAMILY;
  printerModelHint: typeof DYMO_57X32_MODEL_HINT;
  transportMode: ProductLabelPrintTransportMode;
  windowsPrinterName: string | null;
  supportsProductLabels: true;
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

const normalizeBoolean = (value: unknown, field: string, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${field} must be a boolean`, "INVALID_PRINTER");
  }
  return value;
};

const parseUuid = (value: unknown, field: string, code: string) => {
  if (typeof value !== "string" || !UUID_REGEX.test(value.trim())) {
    throw new HttpError(400, `${field} must be a valid UUID`, code);
  }
  return value.trim();
};

const normalizeUuidOrNull = (value: Prisma.JsonValue | null) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return UUID_REGEX.test(trimmed) ? trimmed : null;
};

const normalizePrinterFamily = (value: unknown, fallback: RegisteredPrinterFamily = RegisteredPrinterFamily.ZEBRA_LABEL) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "printerFamily must be a string", "INVALID_PRINTER");
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === ZEBRA_LABEL_PRINTER_FAMILY) {
    return RegisteredPrinterFamily.ZEBRA_LABEL;
  }
  if (normalized === DYMO_LABEL_PRINTER_FAMILY) {
    return RegisteredPrinterFamily.DYMO_LABEL;
  }

  throw new HttpError(
    400,
    `printerFamily must be ${ZEBRA_LABEL_PRINTER_FAMILY} or ${DYMO_LABEL_PRINTER_FAMILY}`,
    "INVALID_PRINTER",
  );
};

const defaultModelHintForFamily = (printerFamily: RegisteredPrinterFamily) =>
  printerFamily === RegisteredPrinterFamily.DYMO_LABEL
    ? DYMO_57X32_MODEL_HINT
    : ZEBRA_GK420D_MODEL_HINT;

const normalizePrinterModelHint = (value: unknown, printerFamily: RegisteredPrinterFamily) => {
  const normalized =
    normalizeOptionalText(value, "printerModelHint", { maxLength: 64 }) ?? defaultModelHintForFamily(printerFamily);

  if (printerFamily === RegisteredPrinterFamily.ZEBRA_LABEL && normalized !== ZEBRA_GK420D_MODEL_HINT) {
    throw new HttpError(
      400,
      `printerModelHint must be ${ZEBRA_GK420D_MODEL_HINT} for Zebra printers`,
      "INVALID_PRINTER",
    );
  }
  if (printerFamily === RegisteredPrinterFamily.DYMO_LABEL && normalized !== DYMO_57X32_MODEL_HINT) {
    throw new HttpError(
      400,
      `printerModelHint must be ${DYMO_57X32_MODEL_HINT} for Dymo printers`,
      "INVALID_PRINTER",
    );
  }

  return normalized;
};

const normalizeTransportMode = (
  value: unknown,
  fallback: RegisteredPrinterTransportMode,
): RegisteredPrinterTransportMode => {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "transportMode must be a string", "INVALID_PRINTER");
  }

  const normalized = value.trim().toUpperCase();
  if (normalized !== "DRY_RUN" && normalized !== "RAW_TCP" && normalized !== "WINDOWS_PRINTER") {
    throw new HttpError(
      400,
      "transportMode must be DRY_RUN, RAW_TCP, or WINDOWS_PRINTER",
      "INVALID_PRINTER",
    );
  }
  return normalized as RegisteredPrinterTransportMode;
};

const ensureTransportMatchesFamily = (
  printerFamily: RegisteredPrinterFamily,
  transportMode: RegisteredPrinterTransportMode,
) => {
  if (
    printerFamily === RegisteredPrinterFamily.ZEBRA_LABEL
    && transportMode !== RegisteredPrinterTransportMode.DRY_RUN
    && transportMode !== RegisteredPrinterTransportMode.RAW_TCP
    && transportMode !== RegisteredPrinterTransportMode.WINDOWS_PRINTER
  ) {
    throw new HttpError(
      400,
      "Zebra printers must use DRY_RUN, RAW_TCP, or WINDOWS_PRINTER transport",
      "INVALID_PRINTER",
    );
  }

  if (
    printerFamily === RegisteredPrinterFamily.DYMO_LABEL
    && transportMode !== RegisteredPrinterTransportMode.DRY_RUN
    && transportMode !== RegisteredPrinterTransportMode.WINDOWS_PRINTER
  ) {
    throw new HttpError(
      400,
      "Dymo printers must use DRY_RUN or WINDOWS_PRINTER transport",
      "INVALID_PRINTER",
    );
  }
};

const ensureCapabilitiesMatchFamily = (
  printerFamily: RegisteredPrinterFamily,
  capabilities: { supportsShippingLabels: boolean; supportsProductLabels: boolean },
) => {
  if (printerFamily === RegisteredPrinterFamily.ZEBRA_LABEL && capabilities.supportsProductLabels) {
    throw new HttpError(
      400,
      "Zebra shipment printers cannot be marked as product-label printers",
      "INVALID_PRINTER",
    );
  }
  if (printerFamily === RegisteredPrinterFamily.DYMO_LABEL && capabilities.supportsShippingLabels) {
    throw new HttpError(
      400,
      "Dymo product-label printers cannot be marked as shipping-label printers",
      "INVALID_PRINTER",
    );
  }
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

const normalizeWindowsPrinterName = (value: unknown) =>
  normalizeOptionalText(value, "windowsPrinterName", { maxLength: 255 });

const normalizeRawTcpPort = (value: unknown, fallback: number) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > 65535) {
    throw new HttpError(400, "rawTcpPort must be an integer between 1 and 65535", "INVALID_PRINTER");
  }
  return Number(value);
};

const writeDefaultPrinterIdTx = async (
  tx: Prisma.TransactionClient,
  key: DefaultPrinterConfigKey,
  printerId: string | null,
) => {
  if (!printerId) {
    await tx.appConfig.deleteMany({
      where: { key },
    });
    return;
  }

  await tx.appConfig.upsert({
    where: { key },
    create: {
      key,
      value: printerId,
    },
    update: {
      value: printerId,
    },
  });
};

const getStoredDefaultPrinterId = async (
  key: DefaultPrinterConfigKey,
  db: PrinterClient = prisma,
) => {
  const row = await db.appConfig.findUnique({
    where: { key },
    select: { value: true },
  });

  return normalizeUuidOrNull(row?.value ?? null);
};

const getStoredPrinterDefaults = async (db: PrinterClient = prisma): Promise<StoredPrinterDefaults> => {
  const [defaultShippingLabelPrinterId, defaultProductLabelPrinterId] = await Promise.all([
    getStoredDefaultPrinterId(DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY, db),
    getStoredDefaultPrinterId(DEFAULT_PRODUCT_LABEL_PRINTER_CONFIG_KEY, db),
  ]);

  return {
    defaultShippingLabelPrinterId,
    defaultProductLabelPrinterId,
  };
};

const toPrinterResponse = (
  printer: PrinterRecord,
  defaults: StoredPrinterDefaults,
): RegisteredPrinterResponse => ({
  id: printer.id,
  name: printer.name,
  key: printer.key,
  printerFamily: printer.printerFamily,
  printerModelHint: printer.printerModelHint,
  supportsShippingLabels: printer.supportsShippingLabels,
  supportsProductLabels: printer.supportsProductLabels,
  isActive: printer.isActive,
  transportMode: printer.transportMode,
  windowsPrinterName: printer.windowsPrinterName ?? null,
  rawTcpHost: printer.rawTcpHost ?? null,
  rawTcpPort: printer.rawTcpPort ?? null,
  location: printer.location ?? null,
  notes: printer.notes ?? null,
  createdAt: printer.createdAt,
  updatedAt: printer.updatedAt,
  isDefaultShippingLabelPrinter: printer.id === defaults.defaultShippingLabelPrinterId,
  isDefaultProductLabelPrinter: printer.id === defaults.defaultProductLabelPrinterId,
});

const ensurePrinterCanBeDefaultShipping = (printer: PrinterRecord) => {
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

const ensurePrinterCanBeDefaultProductLabel = (printer: PrinterRecord) => {
  if (!printer.isActive) {
    throw new HttpError(409, "Inactive printers cannot be the default product-label printer", "PRINTER_INACTIVE");
  }
  if (!printer.supportsProductLabels) {
    throw new HttpError(
      409,
      "This printer does not support product labels",
      "PRINTER_NOT_PRODUCT_LABEL_CAPABLE",
    );
  }
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

const normalizePrinterCreateData = (input: RegisteredPrinterInput) => {
  const printerFamily = normalizePrinterFamily(input.printerFamily);
  const transportMode = normalizeTransportMode(input.transportMode, RegisteredPrinterTransportMode.DRY_RUN);
  ensureTransportMatchesFamily(printerFamily, transportMode);

  const supportsShippingLabels = normalizeBoolean(
    input.supportsShippingLabels,
    "supportsShippingLabels",
    printerFamily === RegisteredPrinterFamily.ZEBRA_LABEL,
  );
  const supportsProductLabels = normalizeBoolean(
    input.supportsProductLabels,
    "supportsProductLabels",
    printerFamily === RegisteredPrinterFamily.DYMO_LABEL,
  );
  ensureCapabilitiesMatchFamily(printerFamily, {
    supportsShippingLabels,
    supportsProductLabels,
  });

  const rawTcpHost = transportMode === RegisteredPrinterTransportMode.RAW_TCP ? normalizeRawTcpHost(input.rawTcpHost) : null;
  const rawTcpPort = transportMode === RegisteredPrinterTransportMode.RAW_TCP
    ? normalizeRawTcpPort(input.rawTcpPort, DEFAULT_RAW_TCP_PORT)
    : null;
  const windowsPrinterName = transportMode === RegisteredPrinterTransportMode.WINDOWS_PRINTER
    ? normalizeWindowsPrinterName(input.windowsPrinterName ?? input.name)
    : null;

  if (transportMode === RegisteredPrinterTransportMode.RAW_TCP && !rawTcpHost) {
    throw new HttpError(400, "rawTcpHost is required when transportMode is RAW_TCP", "INVALID_PRINTER");
  }
  if (transportMode === RegisteredPrinterTransportMode.WINDOWS_PRINTER && !windowsPrinterName) {
    throw new HttpError(
      400,
      "windowsPrinterName is required when transportMode is WINDOWS_PRINTER",
      "INVALID_PRINTER",
    );
  }

  return {
    name: normalizeRequiredText(input.name, "name", 120),
    key: normalizePrinterKey(input.key),
    printerFamily,
    printerModelHint: normalizePrinterModelHint(input.printerModelHint, printerFamily),
    supportsShippingLabels,
    supportsProductLabels,
    isActive: normalizeBoolean(input.isActive, "isActive", true),
    transportMode,
    windowsPrinterName,
    rawTcpHost,
    rawTcpPort,
    location: normalizeOptionalText(input.location, "location", { maxLength: 120 }),
    notes: normalizeOptionalText(input.notes, "notes", { maxLength: 400 }),
    setAsDefaultShippingLabel: input.setAsDefaultShippingLabel === true,
    setAsDefaultProductLabel: input.setAsDefaultProductLabel === true,
  };
};

const normalizePrinterPatchData = (input: RegisteredPrinterInput, existing: PrinterRecord) => {
  if (Object.keys(input).length === 0) {
    throw new HttpError(400, "At least one printer change is required", "INVALID_PRINTER");
  }

  const nextPrinterFamily =
    input.printerFamily !== undefined
      ? normalizePrinterFamily(input.printerFamily, existing.printerFamily)
      : existing.printerFamily;
  const nextTransportMode =
    input.transportMode !== undefined || input.printerFamily !== undefined
      ? normalizeTransportMode(input.transportMode, existing.transportMode)
      : existing.transportMode;
  ensureTransportMatchesFamily(nextPrinterFamily, nextTransportMode);

  const nextSupportsShippingLabels =
    input.supportsShippingLabels !== undefined
      ? normalizeBoolean(input.supportsShippingLabels, "supportsShippingLabels", existing.supportsShippingLabels)
      : existing.supportsShippingLabels;
  const nextSupportsProductLabels =
    input.supportsProductLabels !== undefined
      ? normalizeBoolean(input.supportsProductLabels, "supportsProductLabels", existing.supportsProductLabels)
      : existing.supportsProductLabels;
  ensureCapabilitiesMatchFamily(nextPrinterFamily, {
    supportsShippingLabels: nextSupportsShippingLabels,
    supportsProductLabels: nextSupportsProductLabels,
  });

  const data: Prisma.PrinterUpdateInput = {};

  if (input.name !== undefined) {
    data.name = normalizeRequiredText(input.name, "name", 120);
  }
  if (input.key !== undefined) {
    data.key = normalizePrinterKey(input.key);
  }
  if (input.printerFamily !== undefined) {
    data.printerFamily = nextPrinterFamily;
    data.printerModelHint = normalizePrinterModelHint(input.printerModelHint, nextPrinterFamily);
  } else if (input.printerModelHint !== undefined) {
    data.printerModelHint = normalizePrinterModelHint(input.printerModelHint, nextPrinterFamily);
  }
  if (input.supportsShippingLabels !== undefined) {
    data.supportsShippingLabels = nextSupportsShippingLabels;
  }
  if (input.supportsProductLabels !== undefined) {
    data.supportsProductLabels = nextSupportsProductLabels;
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

  if (
    input.transportMode !== undefined
    || input.windowsPrinterName !== undefined
    || input.rawTcpHost !== undefined
    || input.rawTcpPort !== undefined
    || input.printerFamily !== undefined
  ) {
    data.transportMode = nextTransportMode;
    if (nextTransportMode === RegisteredPrinterTransportMode.RAW_TCP) {
      const rawTcpHost = normalizeRawTcpHost(input.rawTcpHost ?? existing.rawTcpHost);
      if (!rawTcpHost) {
        throw new HttpError(400, "rawTcpHost is required when transportMode is RAW_TCP", "INVALID_PRINTER");
      }
      data.windowsPrinterName = null;
      data.rawTcpHost = rawTcpHost;
      data.rawTcpPort = normalizeRawTcpPort(input.rawTcpPort ?? existing.rawTcpPort, DEFAULT_RAW_TCP_PORT);
    } else if (nextTransportMode === RegisteredPrinterTransportMode.WINDOWS_PRINTER) {
      const windowsPrinterName = normalizeWindowsPrinterName(
        input.windowsPrinterName ?? existing.windowsPrinterName ?? existing.name,
      );
      if (!windowsPrinterName) {
        throw new HttpError(
          400,
          "windowsPrinterName is required when transportMode is WINDOWS_PRINTER",
          "INVALID_PRINTER",
        );
      }
      data.windowsPrinterName = windowsPrinterName;
      data.rawTcpHost = null;
      data.rawTcpPort = null;
    } else {
      data.windowsPrinterName = null;
      data.rawTcpHost = null;
      data.rawTcpPort = null;
    }
  }

  return {
    data,
    setAsDefaultShippingLabel:
      input.setAsDefaultShippingLabel === undefined ? undefined : input.setAsDefaultShippingLabel === true,
    setAsDefaultProductLabel:
      input.setAsDefaultProductLabel === undefined ? undefined : input.setAsDefaultProductLabel === true,
  };
};

export const listRegisteredPrinters = async (
  input: { activeOnly?: boolean; shippingLabelOnly?: boolean; productLabelOnly?: boolean } = {},
  db: PrinterClient = prisma,
): Promise<RegisteredPrinterListResponse> => {
  const where: Prisma.PrinterWhereInput = {};
  if (input.activeOnly) {
    where.isActive = true;
  }
  if (input.shippingLabelOnly) {
    where.supportsShippingLabels = true;
  }
  if (input.productLabelOnly) {
    where.supportsProductLabels = true;
  }

  const [printers, defaults] = await Promise.all([
    db.printer.findMany({
      where,
      select: printerSelect,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    getStoredPrinterDefaults(db),
  ]);

  const mapped = printers.map((printer) => toPrinterResponse(printer, defaults));
  return {
    printers: mapped,
    defaultShippingLabelPrinterId: defaults.defaultShippingLabelPrinterId,
    defaultShippingLabelPrinter:
      mapped.find((printer) => printer.id === defaults.defaultShippingLabelPrinterId) ?? null,
    defaultProductLabelPrinterId: defaults.defaultProductLabelPrinterId,
    defaultProductLabelPrinter:
      mapped.find((printer) => printer.id === defaults.defaultProductLabelPrinterId) ?? null,
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
          supportsProductLabels: normalized.supportsProductLabels,
          isActive: normalized.isActive,
          transportMode: normalized.transportMode,
          windowsPrinterName: normalized.windowsPrinterName,
          rawTcpHost: normalized.rawTcpHost,
          rawTcpPort: normalized.rawTcpPort,
          location: normalized.location,
          notes: normalized.notes,
        },
        select: printerSelect,
      });

      if (normalized.setAsDefaultShippingLabel) {
        ensurePrinterCanBeDefaultShipping(created);
        await writeDefaultPrinterIdTx(tx, DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY, created.id);
      }
      if (normalized.setAsDefaultProductLabel) {
        ensurePrinterCanBeDefaultProductLabel(created);
        await writeDefaultPrinterIdTx(tx, DEFAULT_PRODUCT_LABEL_PRINTER_CONFIG_KEY, created.id);
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
            printerFamily: created.printerFamily,
            transportMode: created.transportMode,
            supportsShippingLabels: created.supportsShippingLabels,
            supportsProductLabels: created.supportsProductLabels,
            isDefaultShippingLabelPrinter: normalized.setAsDefaultShippingLabel,
            isDefaultProductLabelPrinter: normalized.setAsDefaultProductLabel,
          },
        },
        auditActor,
      );

      const defaults = await getStoredPrinterDefaults(tx);
      return {
        printer: toPrinterResponse(created, defaults),
        defaultShippingLabelPrinterId: defaults.defaultShippingLabelPrinterId,
        defaultProductLabelPrinterId: defaults.defaultProductLabelPrinterId,
      };
    });

    logOperationalEvent("dispatch.printer.created", {
      entityId: result.printer.id,
      printerKey: result.printer.key,
      printerFamily: result.printer.printerFamily,
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

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await getPrinterByIdOrThrow(normalizedPrinterId, tx);
      const normalized = normalizePrinterPatchData(input, existing);
      const saved = await tx.printer.update({
        where: { id: existing.id },
        data: normalized.data,
        select: printerSelect,
      });

      const defaultsBefore = await getStoredPrinterDefaults(tx);
      if (defaultsBefore.defaultShippingLabelPrinterId === saved.id && (!saved.isActive || !saved.supportsShippingLabels)) {
        await writeDefaultPrinterIdTx(tx, DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY, null);
      } else if (normalized.setAsDefaultShippingLabel === true) {
        ensurePrinterCanBeDefaultShipping(saved);
        await writeDefaultPrinterIdTx(tx, DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY, saved.id);
      } else if (normalized.setAsDefaultShippingLabel === false && defaultsBefore.defaultShippingLabelPrinterId === saved.id) {
        await writeDefaultPrinterIdTx(tx, DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY, null);
      }

      if (defaultsBefore.defaultProductLabelPrinterId === saved.id && (!saved.isActive || !saved.supportsProductLabels)) {
        await writeDefaultPrinterIdTx(tx, DEFAULT_PRODUCT_LABEL_PRINTER_CONFIG_KEY, null);
      } else if (normalized.setAsDefaultProductLabel === true) {
        ensurePrinterCanBeDefaultProductLabel(saved);
        await writeDefaultPrinterIdTx(tx, DEFAULT_PRODUCT_LABEL_PRINTER_CONFIG_KEY, saved.id);
      } else if (normalized.setAsDefaultProductLabel === false && defaultsBefore.defaultProductLabelPrinterId === saved.id) {
        await writeDefaultPrinterIdTx(tx, DEFAULT_PRODUCT_LABEL_PRINTER_CONFIG_KEY, null);
      }

      const defaults = await getStoredPrinterDefaults(tx);

      await createAuditEventTx(
        tx,
        {
          action: "PRINTER_UPDATED",
          entityType: "PRINTER",
          entityId: saved.id,
          metadata: {
            key: saved.key,
            name: saved.name,
            printerFamily: saved.printerFamily,
            transportMode: saved.transportMode,
            supportsShippingLabels: saved.supportsShippingLabels,
            supportsProductLabels: saved.supportsProductLabels,
            isActive: saved.isActive,
            defaultShippingLabelPrinterId: defaults.defaultShippingLabelPrinterId,
            defaultProductLabelPrinterId: defaults.defaultProductLabelPrinterId,
          },
        },
        auditActor,
      );

      return {
        printer: toPrinterResponse(saved, defaults),
        defaultShippingLabelPrinterId: defaults.defaultShippingLabelPrinterId,
        defaultProductLabelPrinterId: defaults.defaultProductLabelPrinterId,
      };
    });

    logOperationalEvent("dispatch.printer.updated", {
      entityId: result.printer.id,
      printerKey: result.printer.key,
      printerFamily: result.printer.printerFamily,
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
    let defaultProductLabelPrinter: PrinterRecord | null = null;
    if (normalizedPrinterId) {
      printer = await getPrinterByIdOrThrow(normalizedPrinterId, tx);
      ensurePrinterCanBeDefaultShipping(printer);
    }

    await writeDefaultPrinterIdTx(tx, DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY, normalizedPrinterId);

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

    const defaults = await getStoredPrinterDefaults(tx);
    if (defaults.defaultProductLabelPrinterId) {
      defaultProductLabelPrinter = await tx.printer.findUnique({
        where: { id: defaults.defaultProductLabelPrinterId },
        select: printerSelect,
      });
    }
    return {
      defaultShippingLabelPrinterId: defaults.defaultShippingLabelPrinterId,
      defaultShippingLabelPrinter:
        printer && defaults.defaultShippingLabelPrinterId === printer.id
          ? toPrinterResponse(printer, defaults)
          : null,
      defaultProductLabelPrinterId: defaults.defaultProductLabelPrinterId,
      defaultProductLabelPrinter:
        defaultProductLabelPrinter ? toPrinterResponse(defaultProductLabelPrinter, defaults) : null,
    };
  });

  logOperationalEvent("dispatch.printer.default_updated", {
    entityId: result.defaultShippingLabelPrinterId ?? DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY,
    printerId: result.defaultShippingLabelPrinterId,
  });

  return result;
};

export const setDefaultProductLabelPrinter = async (
  printerId: string | null,
  auditActor?: AuditActor,
) => {
  const normalizedPrinterId = printerId ? parseUuid(printerId, "printerId", "INVALID_PRINTER_ID") : null;

  const result = await prisma.$transaction(async (tx) => {
    let printer: PrinterRecord | null = null;
    let defaultShippingLabelPrinter: PrinterRecord | null = null;
    if (normalizedPrinterId) {
      printer = await getPrinterByIdOrThrow(normalizedPrinterId, tx);
      ensurePrinterCanBeDefaultProductLabel(printer);
    }

    await writeDefaultPrinterIdTx(tx, DEFAULT_PRODUCT_LABEL_PRINTER_CONFIG_KEY, normalizedPrinterId);

    await createAuditEventTx(
      tx,
      {
        action: normalizedPrinterId
          ? "DEFAULT_PRODUCT_LABEL_PRINTER_SET"
          : "DEFAULT_PRODUCT_LABEL_PRINTER_CLEARED",
        entityType: "APP_CONFIG",
        entityId: DEFAULT_PRODUCT_LABEL_PRINTER_CONFIG_KEY,
        metadata: {
          printerId: normalizedPrinterId,
          printerKey: printer?.key ?? null,
          printerName: printer?.name ?? null,
        },
      },
      auditActor,
    );

    const defaults = await getStoredPrinterDefaults(tx);
    if (defaults.defaultShippingLabelPrinterId) {
      defaultShippingLabelPrinter = await tx.printer.findUnique({
        where: { id: defaults.defaultShippingLabelPrinterId },
        select: printerSelect,
      });
    }
    return {
      defaultProductLabelPrinterId: defaults.defaultProductLabelPrinterId,
      defaultProductLabelPrinter:
        printer && defaults.defaultProductLabelPrinterId === printer.id
          ? toPrinterResponse(printer, defaults)
          : null,
      defaultShippingLabelPrinterId: defaults.defaultShippingLabelPrinterId,
      defaultShippingLabelPrinter:
        defaultShippingLabelPrinter ? toPrinterResponse(defaultShippingLabelPrinter, defaults) : null,
    };
  });

  logOperationalEvent("product_label.printer.default_updated", {
    entityId: result.defaultProductLabelPrinterId ?? DEFAULT_PRODUCT_LABEL_PRINTER_CONFIG_KEY,
    printerId: result.defaultProductLabelPrinterId,
  });

  return result;
};

const resolvePrinterRecord = async (
  input: ResolvePrinterSelectionInput,
  defaultConfigKey: DefaultPrinterConfigKey,
  defaultMissingCode: string,
  defaultMissingMessage: string,
  db: PrinterClient,
) => {
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
    const defaultPrinterId = await getStoredDefaultPrinterId(defaultConfigKey, db);
    if (!defaultPrinterId) {
      throw new HttpError(409, defaultMissingMessage, defaultMissingCode);
    }
    printer = await db.printer.findUnique({
      where: { id: defaultPrinterId },
      select: printerSelect,
    });
  }

  if (!printer) {
    throw new HttpError(404, "Registered printer not found", "PRINTER_NOT_FOUND");
  }

  return {
    printer,
    resolutionSource,
  };
};

export const resolveShipmentLabelPrinterSelection = async (
  input: ResolvePrinterSelectionInput = {},
  db: PrinterClient = prisma,
): Promise<ResolvedShipmentPrinter> => {
  const { printer, resolutionSource } = await resolvePrinterRecord(
    input,
    DEFAULT_SHIPPING_LABEL_PRINTER_CONFIG_KEY,
    "DEFAULT_SHIPPING_LABEL_PRINTER_NOT_CONFIGURED",
    "No default shipping-label printer is configured. Set one in Settings or choose a registered printer.",
    db,
  );

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
  if (
    printer.transportMode !== RegisteredPrinterTransportMode.DRY_RUN
    && printer.transportMode !== RegisteredPrinterTransportMode.RAW_TCP
    && printer.transportMode !== RegisteredPrinterTransportMode.WINDOWS_PRINTER
  ) {
    throw new HttpError(
      409,
      "Only DRY_RUN, RAW_TCP, and WINDOWS_PRINTER transports are supported for shipment labels",
      "PRINTER_TRANSPORT_NOT_SUPPORTED",
    );
  }
  if (printer.transportMode === RegisteredPrinterTransportMode.RAW_TCP && !printer.rawTcpHost) {
    throw new HttpError(
      409,
      "This RAW_TCP printer is missing its host configuration",
      "PRINTER_TARGET_MISCONFIGURED",
    );
  }
  if (
    printer.transportMode === RegisteredPrinterTransportMode.WINDOWS_PRINTER
    && !printer.windowsPrinterName
  ) {
    throw new HttpError(
      409,
      "This Windows printer is missing its installed printer name",
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
    windowsPrinterName: printer.transportMode === RegisteredPrinterTransportMode.WINDOWS_PRINTER
      ? printer.windowsPrinterName ?? printer.name
      : null,
    rawTcpHost: printer.rawTcpHost ?? null,
    rawTcpPort: printer.transportMode === RegisteredPrinterTransportMode.RAW_TCP
      ? printer.rawTcpPort ?? DEFAULT_RAW_TCP_PORT
      : null,
    supportsShippingLabels: true,
    isActive: true,
    resolutionSource,
  };
};

export const resolveProductLabelPrinterSelection = async (
  input: ResolvePrinterSelectionInput = {},
  db: PrinterClient = prisma,
): Promise<ResolvedProductLabelPrinter> => {
  const { printer, resolutionSource } = await resolvePrinterRecord(
    input,
    DEFAULT_PRODUCT_LABEL_PRINTER_CONFIG_KEY,
    "DEFAULT_PRODUCT_LABEL_PRINTER_NOT_CONFIGURED",
    "No default product-label printer is configured. Set one in Settings or choose a registered printer.",
    db,
  );

  if (!printer.isActive) {
    throw new HttpError(409, "This printer is inactive and cannot be used", "PRINTER_INACTIVE");
  }
  if (!printer.supportsProductLabels) {
    throw new HttpError(
      409,
      "This printer is not configured for product labels",
      "PRINTER_NOT_PRODUCT_LABEL_CAPABLE",
    );
  }
  if (printer.printerFamily !== RegisteredPrinterFamily.DYMO_LABEL) {
    throw new HttpError(
      409,
      "Only Dymo-style product-label printers are supported in this flow",
      "PRINTER_FAMILY_NOT_SUPPORTED",
    );
  }
  if (printer.printerModelHint !== DYMO_57X32_MODEL_HINT) {
    throw new HttpError(
      409,
      "Only 57x32-compatible Dymo printer model hints are supported in this flow",
      "PRINTER_MODEL_NOT_SUPPORTED",
    );
  }
  if (
    printer.transportMode !== RegisteredPrinterTransportMode.DRY_RUN
    && printer.transportMode !== RegisteredPrinterTransportMode.WINDOWS_PRINTER
  ) {
    throw new HttpError(
      409,
      "Only DRY_RUN and WINDOWS_PRINTER transports are supported for product labels",
      "PRINTER_TRANSPORT_NOT_SUPPORTED",
    );
  }
  if (
    printer.transportMode === RegisteredPrinterTransportMode.WINDOWS_PRINTER
    && !printer.windowsPrinterName
  ) {
    throw new HttpError(
      409,
      "This Windows printer is missing its installed printer name",
      "PRINTER_TARGET_MISCONFIGURED",
    );
  }

  return {
    id: printer.id,
    key: printer.key,
    name: printer.name,
    printerFamily: DYMO_LABEL_PRINTER_FAMILY,
    printerModelHint: DYMO_57X32_MODEL_HINT,
    transportMode: printer.transportMode,
    windowsPrinterName: printer.transportMode === RegisteredPrinterTransportMode.WINDOWS_PRINTER
      ? printer.windowsPrinterName ?? printer.name
      : null,
    supportsProductLabels: true,
    isActive: true,
    resolutionSource,
  };
};
