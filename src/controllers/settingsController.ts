import { Request, Response } from "express";
import { getRequestAuditActor } from "../middleware/staffRole";
import {
  listShopSettings,
  listStoreInfoSettings,
  updateShopSettings,
  updateStoreInfoSettings,
} from "../services/configurationService";
import {
  createRegisteredPrinter,
  listRegisteredPrinters,
  setDefaultShippingLabelPrinter,
  updateRegisteredPrinter,
} from "../services/printerService";
import { removeStoreLogo, uploadStoreLogo } from "../services/storeLogoService";
import { HttpError } from "../utils/http";

const assertOptionalString = (value: unknown, field: string) => {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new HttpError(400, `${field} must be a string`, "INVALID_PRINTER");
  }
};

const assertOptionalBoolean = (value: unknown, field: string) => {
  if (value !== undefined && typeof value !== "boolean") {
    throw new HttpError(400, `${field} must be a boolean`, "INVALID_PRINTER");
  }
};

const assertOptionalInteger = (value: unknown, field: string) => {
  if (value !== undefined && value !== null && (!Number.isInteger(value) || Number(value) <= 0)) {
    throw new HttpError(400, `${field} must be a positive integer`, "INVALID_PRINTER");
  }
};

const parseBooleanQuery = (value: unknown) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "boolean query values must be strings", "INVALID_PRINTER");
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  throw new HttpError(400, "boolean query values must be true/false", "INVALID_PRINTER");
};

const toRegisteredPrinterInput = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "printer body must be an object", "INVALID_PRINTER");
  }

  const record = body as Record<string, unknown>;
  assertOptionalString(record.name, "name");
  assertOptionalString(record.key, "key");
  assertOptionalString(record.printerFamily, "printerFamily");
  assertOptionalString(record.printerModelHint, "printerModelHint");
  assertOptionalBoolean(record.supportsShippingLabels, "supportsShippingLabels");
  assertOptionalBoolean(record.isActive, "isActive");
  assertOptionalString(record.transportMode, "transportMode");
  assertOptionalString(record.rawTcpHost, "rawTcpHost");
  assertOptionalInteger(record.rawTcpPort, "rawTcpPort");
  assertOptionalString(record.location, "location");
  assertOptionalString(record.notes, "notes");
  assertOptionalBoolean(record.setAsDefaultShippingLabel, "setAsDefaultShippingLabel");

  return {
    name: record.name as string | undefined,
    key: record.key as string | undefined,
    printerFamily: record.printerFamily as string | undefined,
    printerModelHint: record.printerModelHint as string | undefined,
    supportsShippingLabels: record.supportsShippingLabels as boolean | undefined,
    isActive: record.isActive as boolean | undefined,
    transportMode: record.transportMode as string | undefined,
    rawTcpHost: record.rawTcpHost as string | null | undefined,
    rawTcpPort: record.rawTcpPort as number | null | undefined,
    location: record.location as string | null | undefined,
    notes: record.notes as string | null | undefined,
    setAsDefaultShippingLabel: record.setAsDefaultShippingLabel as boolean | undefined,
  };
};

export const listSettingsHandler = async (_req: Request, res: Response) => {
  const settings = await listShopSettings();
  res.json({ settings });
};

export const updateSettingsHandler = async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new HttpError(400, "settings patch body must be an object", "INVALID_SETTINGS");
  }

  const settings = await updateShopSettings(req.body as Parameters<typeof updateShopSettings>[0]);
  res.json({ settings });
};

export const listStoreInfoHandler = async (_req: Request, res: Response) => {
  const store = await listStoreInfoSettings();
  res.json({ store });
};

export const updateStoreInfoHandler = async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new HttpError(400, "store info patch body must be an object", "INVALID_SETTINGS");
  }

  const store = await updateStoreInfoSettings(
    req.body as Parameters<typeof updateStoreInfoSettings>[0],
  );
  res.json({ store });
};

export const uploadStoreLogoHandler = async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new HttpError(400, "store logo upload body must be an object", "INVALID_STORE_LOGO");
  }

  const body = req.body as { fileDataUrl?: unknown };
  if (typeof body.fileDataUrl !== "string") {
    throw new HttpError(400, "fileDataUrl must be a string", "INVALID_STORE_LOGO");
  }

  const store = await uploadStoreLogo({ fileDataUrl: body.fileDataUrl });
  res.status(201).json({ store });
};

export const removeStoreLogoHandler = async (_req: Request, res: Response) => {
  const store = await removeStoreLogo();
  res.json({ store });
};

export const listRegisteredPrintersHandler = async (req: Request, res: Response) => {
  const payload = await listRegisteredPrinters({
    activeOnly: parseBooleanQuery(req.query.activeOnly),
    shippingLabelOnly: parseBooleanQuery(req.query.shippingLabelOnly),
  });
  res.json(payload);
};

export const createRegisteredPrinterHandler = async (req: Request, res: Response) => {
  const result = await createRegisteredPrinter(
    toRegisteredPrinterInput(req.body),
    getRequestAuditActor(req),
  );
  res.status(201).json(result);
};

export const updateRegisteredPrinterHandler = async (req: Request, res: Response) => {
  const result = await updateRegisteredPrinter(
    req.params.printerId,
    toRegisteredPrinterInput(req.body),
    getRequestAuditActor(req),
  );
  res.json(result);
};

export const setDefaultShippingLabelPrinterHandler = async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new HttpError(400, "default printer body must be an object", "INVALID_PRINTER");
  }

  const body = req.body as { printerId?: unknown };
  if (body.printerId !== undefined && body.printerId !== null && typeof body.printerId !== "string") {
    throw new HttpError(400, "printerId must be a string or null", "INVALID_PRINTER");
  }

  const result = await setDefaultShippingLabelPrinter(
    (body.printerId as string | null | undefined) ?? null,
    getRequestAuditActor(req),
  );
  res.json(result);
};
