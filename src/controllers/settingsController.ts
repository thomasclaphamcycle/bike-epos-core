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
import {
  listShippingProviderSettings,
  setDefaultShippingProvider,
  updateShippingProviderSettings,
} from "../services/shipping/providerConfigService";
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

const toShippingProviderSettingsInput = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(
      400,
      "shipping provider body must be an object",
      "INVALID_SHIPPING_PROVIDER_SETTINGS",
    );
  }

  const record = body as Record<string, unknown>;
  if (record.enabled !== undefined && typeof record.enabled !== "boolean") {
    throw new HttpError(400, "enabled must be a boolean", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }
  if (record.environment !== undefined && record.environment !== null && typeof record.environment !== "string") {
    throw new HttpError(400, "environment must be a string", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }
  if (record.displayName !== undefined && record.displayName !== null && typeof record.displayName !== "string") {
    throw new HttpError(400, "displayName must be a string", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }
  if (record.endpointBaseUrl !== undefined && record.endpointBaseUrl !== null && typeof record.endpointBaseUrl !== "string") {
    throw new HttpError(400, "endpointBaseUrl must be a string", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }
  if (record.accountId !== undefined && record.accountId !== null && typeof record.accountId !== "string") {
    throw new HttpError(400, "accountId must be a string", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }
  if (record.apiBaseUrl !== undefined && record.apiBaseUrl !== null && typeof record.apiBaseUrl !== "string") {
    throw new HttpError(400, "apiBaseUrl must be a string", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }
  if (
    record.carrierAccountId !== undefined
    && record.carrierAccountId !== null
    && typeof record.carrierAccountId !== "string"
  ) {
    throw new HttpError(400, "carrierAccountId must be a string", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }
  if (
    record.defaultServiceCode !== undefined
    && record.defaultServiceCode !== null
    && typeof record.defaultServiceCode !== "string"
  ) {
    throw new HttpError(400, "defaultServiceCode must be a string", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }
  if (
    record.defaultServiceName !== undefined
    && record.defaultServiceName !== null
    && typeof record.defaultServiceName !== "string"
  ) {
    throw new HttpError(400, "defaultServiceName must be a string", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }
  for (const numericField of ["parcelWeightOz", "parcelLengthIn", "parcelWidthIn", "parcelHeightIn"] as const) {
    const value = record[numericField];
    if (value !== undefined && value !== null && typeof value !== "number") {
      throw new HttpError(400, `${numericField} must be a number`, "INVALID_SHIPPING_PROVIDER_SETTINGS");
    }
  }
  if (record.apiKey !== undefined && record.apiKey !== null && typeof record.apiKey !== "string") {
    throw new HttpError(400, "apiKey must be a string", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }
  if (record.clearApiKey !== undefined && typeof record.clearApiKey !== "boolean") {
    throw new HttpError(400, "clearApiKey must be a boolean", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }

  return {
    enabled: record.enabled as boolean | undefined,
    environment: record.environment as string | undefined,
    displayName: record.displayName as string | null | undefined,
    endpointBaseUrl: record.endpointBaseUrl as string | null | undefined,
    apiBaseUrl: record.apiBaseUrl as string | null | undefined,
    accountId: record.accountId as string | null | undefined,
    carrierAccountId: record.carrierAccountId as string | null | undefined,
    defaultServiceCode: record.defaultServiceCode as string | null | undefined,
    defaultServiceName: record.defaultServiceName as string | null | undefined,
    parcelWeightOz: record.parcelWeightOz as number | null | undefined,
    parcelLengthIn: record.parcelLengthIn as number | null | undefined,
    parcelWidthIn: record.parcelWidthIn as number | null | undefined,
    parcelHeightIn: record.parcelHeightIn as number | null | undefined,
    apiKey: record.apiKey as string | null | undefined,
    clearApiKey: record.clearApiKey as boolean | undefined,
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

export const listShippingProvidersHandler = async (_req: Request, res: Response) => {
  const payload = await listShippingProviderSettings();
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

export const updateShippingProviderSettingsHandler = async (req: Request, res: Response) => {
  const result = await updateShippingProviderSettings(
    req.params.providerKey,
    toShippingProviderSettingsInput(req.body),
    getRequestAuditActor(req),
  );
  res.json(result);
};

export const setDefaultShippingProviderHandler = async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new HttpError(
      400,
      "default shipping provider body must be an object",
      "INVALID_SHIPPING_PROVIDER_SETTINGS",
    );
  }

  const body = req.body as { providerKey?: unknown };
  if (body.providerKey !== undefined && body.providerKey !== null && typeof body.providerKey !== "string") {
    throw new HttpError(
      400,
      "providerKey must be a string or null",
      "INVALID_SHIPPING_PROVIDER_SETTINGS",
    );
  }

  const result = await setDefaultShippingProvider(
    (body.providerKey as string | null | undefined) ?? null,
    getRequestAuditActor(req),
  );
  res.json(result);
};
