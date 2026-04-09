import { Request, Response } from "express";
import { getRequestAuditActor } from "../middleware/staffRole";
import {
  listBikeTagPrintAgentSettings,
  updateBikeTagPrintAgentSettings,
} from "../services/bikeTagPrintAgentConfigService";
import {
  listReceiptPrintAgentSettings,
  updateReceiptPrintAgentSettings,
} from "../services/receiptPrintAgentConfigService";
import {
  listShopSettings,
  listStoreInfoSettings,
  updateShopSettings,
  updateStoreInfoSettings,
} from "../services/configurationService";
import {
  listProductLabelPrintAgentSettings,
  updateProductLabelPrintAgentSettings,
} from "../services/productLabelPrintAgentConfigService";
import {
  listShippingPrintAgentSettings,
  updateShippingPrintAgentSettings,
} from "../services/shipping/printAgentConfigService";
import {
  createRegisteredPrinter,
  listRegisteredPrinters,
  setDefaultBikeTagPrinter,
  setDefaultProductLabelPrinter,
  setDefaultReceiptPrinter,
  setDefaultShippingLabelPrinter,
  updateRegisteredPrinter,
} from "../services/printerService";
import {
  listReceiptPrintStations,
  updateReceiptPrintStations,
} from "../services/receiptPrintStationService";
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
  assertOptionalBoolean(record.supportsProductLabels, "supportsProductLabels");
  assertOptionalBoolean(record.supportsBikeTags, "supportsBikeTags");
  assertOptionalBoolean(record.supportsReceipts, "supportsReceipts");
  assertOptionalBoolean(record.isActive, "isActive");
  assertOptionalString(record.transportMode, "transportMode");
  assertOptionalString(record.windowsPrinterName, "windowsPrinterName");
  assertOptionalString(record.rawTcpHost, "rawTcpHost");
  assertOptionalInteger(record.rawTcpPort, "rawTcpPort");
  assertOptionalString(record.location, "location");
  assertOptionalString(record.notes, "notes");
  assertOptionalBoolean(record.setAsDefaultShippingLabel, "setAsDefaultShippingLabel");
  assertOptionalBoolean(record.setAsDefaultProductLabel, "setAsDefaultProductLabel");
  assertOptionalBoolean(record.setAsDefaultBikeTag, "setAsDefaultBikeTag");
  assertOptionalBoolean(record.setAsDefaultReceipt, "setAsDefaultReceipt");

  return {
    name: record.name as string | undefined,
    key: record.key as string | undefined,
    printerFamily: record.printerFamily as string | undefined,
    printerModelHint: record.printerModelHint as string | undefined,
    supportsShippingLabels: record.supportsShippingLabels as boolean | undefined,
    supportsProductLabels: record.supportsProductLabels as boolean | undefined,
    supportsBikeTags: record.supportsBikeTags as boolean | undefined,
    supportsReceipts: record.supportsReceipts as boolean | undefined,
    isActive: record.isActive as boolean | undefined,
    transportMode: record.transportMode as string | undefined,
    windowsPrinterName: record.windowsPrinterName as string | null | undefined,
    rawTcpHost: record.rawTcpHost as string | null | undefined,
    rawTcpPort: record.rawTcpPort as number | null | undefined,
    location: record.location as string | null | undefined,
    notes: record.notes as string | null | undefined,
    setAsDefaultShippingLabel: record.setAsDefaultShippingLabel as boolean | undefined,
    setAsDefaultProductLabel: record.setAsDefaultProductLabel as boolean | undefined,
    setAsDefaultBikeTag: record.setAsDefaultBikeTag as boolean | undefined,
    setAsDefaultReceipt: record.setAsDefaultReceipt as boolean | undefined,
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
  if (record.webhookSecret !== undefined && record.webhookSecret !== null && typeof record.webhookSecret !== "string") {
    throw new HttpError(400, "webhookSecret must be a string", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }
  if (record.apiKey !== undefined && record.apiKey !== null && typeof record.apiKey !== "string") {
    throw new HttpError(400, "apiKey must be a string", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }
  if (record.clearWebhookSecret !== undefined && typeof record.clearWebhookSecret !== "boolean") {
    throw new HttpError(400, "clearWebhookSecret must be a boolean", "INVALID_SHIPPING_PROVIDER_SETTINGS");
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
    webhookSecret: record.webhookSecret as string | null | undefined,
    apiKey: record.apiKey as string | null | undefined,
    clearWebhookSecret: record.clearWebhookSecret as boolean | undefined,
    clearApiKey: record.clearApiKey as boolean | undefined,
  };
};

const toProductLabelPrintAgentSettingsInput = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(
      400,
      "product-label print agent body must be an object",
      "INVALID_PRODUCT_LABEL_PRINT_AGENT_SETTINGS",
    );
  }

  const record = body as Record<string, unknown>;
  if (record.url !== undefined && record.url !== null && typeof record.url !== "string") {
    throw new HttpError(400, "url must be a string or null", "INVALID_PRODUCT_LABEL_PRINT_AGENT_SETTINGS");
  }
  if (
    record.sharedSecret !== undefined
    && record.sharedSecret !== null
    && typeof record.sharedSecret !== "string"
  ) {
    throw new HttpError(
      400,
      "sharedSecret must be a string or null",
      "INVALID_PRODUCT_LABEL_PRINT_AGENT_SETTINGS",
    );
  }
  if (record.clearSharedSecret !== undefined && typeof record.clearSharedSecret !== "boolean") {
    throw new HttpError(
      400,
      "clearSharedSecret must be a boolean",
      "INVALID_PRODUCT_LABEL_PRINT_AGENT_SETTINGS",
    );
  }

  return {
    url: record.url as string | null | undefined,
    sharedSecret: record.sharedSecret as string | null | undefined,
    clearSharedSecret: record.clearSharedSecret as boolean | undefined,
  };
};

const toShippingPrintAgentSettingsInput = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(
      400,
      "shipping print agent body must be an object",
      "INVALID_SHIPPING_PRINT_AGENT_SETTINGS",
    );
  }

  const record = body as Record<string, unknown>;
  if (record.url !== undefined && record.url !== null && typeof record.url !== "string") {
    throw new HttpError(400, "url must be a string or null", "INVALID_SHIPPING_PRINT_AGENT_SETTINGS");
  }
  if (
    record.sharedSecret !== undefined
    && record.sharedSecret !== null
    && typeof record.sharedSecret !== "string"
  ) {
    throw new HttpError(400, "sharedSecret must be a string or null", "INVALID_SHIPPING_PRINT_AGENT_SETTINGS");
  }
  if (record.clearSharedSecret !== undefined && typeof record.clearSharedSecret !== "boolean") {
    throw new HttpError(
      400,
      "clearSharedSecret must be a boolean",
      "INVALID_SHIPPING_PRINT_AGENT_SETTINGS",
    );
  }

  return {
    url: record.url as string | null | undefined,
    sharedSecret: record.sharedSecret as string | null | undefined,
    clearSharedSecret: record.clearSharedSecret as boolean | undefined,
  };
};

const toBikeTagPrintAgentSettingsInput = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(
      400,
      "bike-tag print agent body must be an object",
      "INVALID_BIKE_TAG_PRINT_AGENT_SETTINGS",
    );
  }

  const record = body as Record<string, unknown>;
  if (record.url !== undefined && record.url !== null && typeof record.url !== "string") {
    throw new HttpError(400, "url must be a string or null", "INVALID_BIKE_TAG_PRINT_AGENT_SETTINGS");
  }
  if (
    record.sharedSecret !== undefined
    && record.sharedSecret !== null
    && typeof record.sharedSecret !== "string"
  ) {
    throw new HttpError(400, "sharedSecret must be a string or null", "INVALID_BIKE_TAG_PRINT_AGENT_SETTINGS");
  }
  if (record.clearSharedSecret !== undefined && typeof record.clearSharedSecret !== "boolean") {
    throw new HttpError(
      400,
      "clearSharedSecret must be a boolean",
      "INVALID_BIKE_TAG_PRINT_AGENT_SETTINGS",
    );
  }

  return {
    url: record.url as string | null | undefined,
    sharedSecret: record.sharedSecret as string | null | undefined,
    clearSharedSecret: record.clearSharedSecret as boolean | undefined,
  };
};

const toReceiptPrintAgentSettingsInput = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(
      400,
      "receipt print agent body must be an object",
      "INVALID_RECEIPT_PRINT_AGENT_SETTINGS",
    );
  }

  const record = body as Record<string, unknown>;
  if (record.url !== undefined && record.url !== null && typeof record.url !== "string") {
    throw new HttpError(400, "url must be a string or null", "INVALID_RECEIPT_PRINT_AGENT_SETTINGS");
  }
  if (
    record.sharedSecret !== undefined
    && record.sharedSecret !== null
    && typeof record.sharedSecret !== "string"
  ) {
    throw new HttpError(400, "sharedSecret must be a string or null", "INVALID_RECEIPT_PRINT_AGENT_SETTINGS");
  }
  if (record.clearSharedSecret !== undefined && typeof record.clearSharedSecret !== "boolean") {
    throw new HttpError(
      400,
      "clearSharedSecret must be a boolean",
      "INVALID_RECEIPT_PRINT_AGENT_SETTINGS",
    );
  }

  return {
    url: record.url as string | null | undefined,
    sharedSecret: record.sharedSecret as string | null | undefined,
    clearSharedSecret: record.clearSharedSecret as boolean | undefined,
  };
};

const toReceiptPrintStationSettingsInput = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(
      400,
      "receipt workstation body must be an object",
      "INVALID_RECEIPT_WORKSTATION_SETTINGS",
    );
  }

  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.workstations)) {
    throw new HttpError(
      400,
      "workstations must be an array",
      "INVALID_RECEIPT_WORKSTATION_SETTINGS",
    );
  }

  return {
    workstations: record.workstations.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new HttpError(
          400,
          `workstations[${index}] must be an object`,
          "INVALID_RECEIPT_WORKSTATION_SETTINGS",
        );
      }
      const workstation = entry as Record<string, unknown>;
      if (typeof workstation.key !== "string") {
        throw new HttpError(
          400,
          `workstations[${index}].key must be a string`,
          "INVALID_RECEIPT_WORKSTATION_SETTINGS",
        );
      }
      if (
        workstation.defaultPrinterId !== undefined
        && workstation.defaultPrinterId !== null
        && typeof workstation.defaultPrinterId !== "string"
      ) {
        throw new HttpError(
          400,
          `workstations[${index}].defaultPrinterId must be a string or null`,
          "INVALID_RECEIPT_WORKSTATION_SETTINGS",
        );
      }

      return {
        key: workstation.key,
        defaultPrinterId: workstation.defaultPrinterId as string | null | undefined,
      };
    }),
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

export const listProductLabelPrintAgentSettingsHandler = async (_req: Request, res: Response) => {
  const config = await listProductLabelPrintAgentSettings();
  res.json({ config });
};

export const listBikeTagPrintAgentSettingsHandler = async (_req: Request, res: Response) => {
  const config = await listBikeTagPrintAgentSettings();
  res.json({ config });
};

export const listReceiptPrintAgentSettingsHandler = async (_req: Request, res: Response) => {
  const config = await listReceiptPrintAgentSettings();
  res.json({ config });
};

export const listShippingPrintAgentSettingsHandler = async (_req: Request, res: Response) => {
  const config = await listShippingPrintAgentSettings();
  res.json({ config });
};

export const listReceiptPrintStationsHandler = async (_req: Request, res: Response) => {
  const config = await listReceiptPrintStations();
  res.json({ config });
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
    productLabelOnly: parseBooleanQuery(req.query.productLabelOnly),
    bikeTagOnly: parseBooleanQuery(req.query.bikeTagOnly),
    receiptOnly: parseBooleanQuery(req.query.receiptOnly),
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

export const setDefaultProductLabelPrinterHandler = async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new HttpError(400, "default printer body must be an object", "INVALID_PRINTER");
  }

  const body = req.body as { printerId?: unknown };
  if (body.printerId !== undefined && body.printerId !== null && typeof body.printerId !== "string") {
    throw new HttpError(400, "printerId must be a string or null", "INVALID_PRINTER");
  }

  const result = await setDefaultProductLabelPrinter(
    (body.printerId as string | null | undefined) ?? null,
    getRequestAuditActor(req),
  );
  res.json(result);
};

export const setDefaultBikeTagPrinterHandler = async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new HttpError(400, "default printer body must be an object", "INVALID_PRINTER");
  }

  const body = req.body as { printerId?: unknown };
  if (body.printerId !== undefined && body.printerId !== null && typeof body.printerId !== "string") {
    throw new HttpError(400, "printerId must be a string or null", "INVALID_PRINTER");
  }

  const result = await setDefaultBikeTagPrinter(
    (body.printerId as string | null | undefined) ?? null,
    getRequestAuditActor(req),
  );
  res.json(result);
};

export const setDefaultReceiptPrinterHandler = async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new HttpError(400, "default printer body must be an object", "INVALID_PRINTER");
  }

  const body = req.body as { printerId?: unknown };
  if (body.printerId !== undefined && body.printerId !== null && typeof body.printerId !== "string") {
    throw new HttpError(400, "printerId must be a string or null", "INVALID_PRINTER");
  }

  const result = await setDefaultReceiptPrinter(
    (body.printerId as string | null | undefined) ?? null,
    getRequestAuditActor(req),
  );
  res.json(result);
};

export const updateProductLabelPrintAgentSettingsHandler = async (req: Request, res: Response) => {
  const config = await updateProductLabelPrintAgentSettings(
    toProductLabelPrintAgentSettingsInput(req.body),
    getRequestAuditActor(req),
  );
  res.json({ config });
};

export const updateShippingPrintAgentSettingsHandler = async (req: Request, res: Response) => {
  const config = await updateShippingPrintAgentSettings(
    toShippingPrintAgentSettingsInput(req.body),
    getRequestAuditActor(req),
  );
  res.json({ config });
};

export const updateBikeTagPrintAgentSettingsHandler = async (req: Request, res: Response) => {
  const config = await updateBikeTagPrintAgentSettings(
    toBikeTagPrintAgentSettingsInput(req.body),
    getRequestAuditActor(req),
  );
  res.json({ config });
};

export const updateReceiptPrintAgentSettingsHandler = async (req: Request, res: Response) => {
  const config = await updateReceiptPrintAgentSettings(
    toReceiptPrintAgentSettingsInput(req.body),
    getRequestAuditActor(req),
  );
  res.json({ config });
};

export const updateReceiptPrintStationsHandler = async (req: Request, res: Response) => {
  const config = await updateReceiptPrintStations(
    toReceiptPrintStationSettingsInput(req.body),
    getRequestAuditActor(req),
  );
  res.json({ config });
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
