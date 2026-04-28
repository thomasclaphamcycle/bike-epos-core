import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { invalidateAppConfigCache } from "../config/appConfig";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import {
  getManagedPrintJobStatusBadgeClassName,
  getManagedPrintJobStatusLabel,
  listManagedPrintJobs,
  retryManagedPrintJob,
  type ManagedPrintJobSummary,
  type ManagedPrintWorkflowType,
} from "../features/printing/managedPrintJobs";
import {
  getStoredReceiptWorkstationKey,
  setStoredReceiptWorkstationKey,
} from "../features/receipts/receiptWorkstation";

const STORE_WEEKDAYS = [
  { key: "MONDAY", label: "Monday" },
  { key: "TUESDAY", label: "Tuesday" },
  { key: "WEDNESDAY", label: "Wednesday" },
  { key: "THURSDAY", label: "Thursday" },
  { key: "FRIDAY", label: "Friday" },
  { key: "SATURDAY", label: "Saturday" },
  { key: "SUNDAY", label: "Sunday" },
] as const;

type StoreWeekdayKey = typeof STORE_WEEKDAYS[number]["key"];

type StoreDailyOpeningHours = {
  isClosed: boolean;
  opensAt: string;
  closesAt: string;
};

type StoreOpeningHours = Record<StoreWeekdayKey, StoreDailyOpeningHours>;

const DEFAULT_OPENING_HOURS: StoreOpeningHours = {
  MONDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  TUESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  WEDNESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  THURSDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  FRIDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  SATURDAY: { isClosed: false, opensAt: "09:00", closesAt: "16:30" },
  SUNDAY: { isClosed: true, opensAt: "", closesAt: "" },
};

type StoreInfo = {
  name: string;
  businessName: string;
  email: string;
  phone: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postcode: string;
  country: string;
  vatNumber: string;
  companyNumber: string;
  defaultCurrency: string;
  timeZone: string;
  logoUrl: string;
  uploadedLogoPath: string;
  footerText: string;
  openingHours: StoreOpeningHours;
};

type StoreInfoResponse = {
  store: StoreInfo & {
    preferredLogoUrl?: string;
  };
};

type WorkshopCommercialSettings = {
  commercialSuggestionsEnabled: boolean;
  commercialLongGapDays: number;
  commercialRecentServiceCooldownDays: number;
};

type SettingsResponse = {
  settings: {
    workshop: WorkshopCommercialSettings;
  };
};

type RegisteredPrinterFamily = "ZEBRA_LABEL" | "DYMO_LABEL" | "OFFICE_DOCUMENT" | "THERMAL_RECEIPT";
type RegisteredPrinterModelHint =
  | "GK420D_OR_COMPATIBLE"
  | "LABELWRITER_57X32_OR_COMPATIBLE"
  | "A5_LANDSCAPE_2UP_OR_COMPATIBLE"
  | "ESC_POS_80MM_OR_COMPATIBLE";
type RegisteredPrinterTransportMode = "DRY_RUN" | "RAW_TCP" | "WINDOWS_PRINTER";

type RegisteredPrinter = {
  id: string;
  name: string;
  key: string;
  printerFamily: RegisteredPrinterFamily;
  printerModelHint: RegisteredPrinterModelHint;
  supportsShippingLabels: boolean;
  supportsProductLabels: boolean;
  supportsBikeTags: boolean;
  supportsReceipts: boolean;
  isActive: boolean;
  transportMode: RegisteredPrinterTransportMode;
  windowsPrinterName: string | null;
  rawTcpHost: string | null;
  rawTcpPort: number | null;
  location: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  isDefaultShippingLabelPrinter: boolean;
  isDefaultProductLabelPrinter: boolean;
  isDefaultBikeTagPrinter: boolean;
  isDefaultReceiptPrinter: boolean;
};

type RegisteredPrinterListResponse = {
  printers: RegisteredPrinter[];
  defaultShippingLabelPrinterId: string | null;
  defaultShippingLabelPrinter: RegisteredPrinter | null;
  defaultProductLabelPrinterId: string | null;
  defaultProductLabelPrinter: RegisteredPrinter | null;
  defaultBikeTagPrinterId: string | null;
  defaultBikeTagPrinter: RegisteredPrinter | null;
  defaultReceiptPrinterId: string | null;
  defaultReceiptPrinter: RegisteredPrinter | null;
};

type PrinterMutationResponse = {
  printer: RegisteredPrinter;
  defaultShippingLabelPrinterId: string | null;
  defaultProductLabelPrinterId: string | null;
  defaultBikeTagPrinterId: string | null;
  defaultReceiptPrinterId: string | null;
};

type DefaultPrinterResponse = {
  defaultShippingLabelPrinterId: string | null;
  defaultShippingLabelPrinter: RegisteredPrinter | null;
  defaultProductLabelPrinterId: string | null;
  defaultProductLabelPrinter: RegisteredPrinter | null;
  defaultBikeTagPrinterId: string | null;
  defaultBikeTagPrinter: RegisteredPrinter | null;
  defaultReceiptPrinterId: string | null;
  defaultReceiptPrinter: RegisteredPrinter | null;
};

type PrinterFormState = {
  name: string;
  key: string;
  printerFamily: RegisteredPrinterFamily;
  printerModelHint: RegisteredPrinterModelHint;
  supportsShippingLabels: boolean;
  supportsProductLabels: boolean;
  supportsBikeTags: boolean;
  supportsReceipts: boolean;
  isActive: boolean;
  transportMode: RegisteredPrinterTransportMode;
  windowsPrinterName: string;
  rawTcpHost: string;
  rawTcpPort: string;
  location: string;
  notes: string;
  setAsDefaultShippingLabel: boolean;
  setAsDefaultProductLabel: boolean;
  setAsDefaultBikeTag: boolean;
  setAsDefaultReceipt: boolean;
};

type ShippingProviderEnvironment = "SANDBOX" | "LIVE";

type ShippingProviderConfiguration = {
  enabled: boolean;
  environment: ShippingProviderEnvironment;
  displayName: string | null;
  endpointBaseUrl: string | null;
  apiBaseUrl: string | null;
  accountId: string | null;
  carrierAccountId: string | null;
  defaultServiceCode: string | null;
  defaultServiceName: string | null;
  parcelWeightOz: number | null;
  parcelLengthIn: number | null;
  parcelWidthIn: number | null;
  parcelHeightIn: number | null;
  hasWebhookSecret: boolean;
  webhookSecretHint: string | null;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  updatedAt: string;
};

type ShippingProviderSettings = {
  key: string;
  displayName: string;
  mode: "mock" | "integration";
  implementationState: "mock" | "scaffold" | "live";
  requiresConfiguration: boolean;
  supportsWebhookEvents: boolean;
  supportedLabelFormats: string[];
  defaultServiceCode: string;
  defaultServiceName: string;
  isDefaultProvider: boolean;
  isAvailable: boolean;
  configuration: ShippingProviderConfiguration | null;
};

type ShippingProviderSettingsListResponse = {
  defaultProviderKey: string;
  providers: ShippingProviderSettings[];
};

type ShippingProviderMutationResponse = {
  provider: ShippingProviderSettings;
};

type ShippingProviderFormState = {
  enabled: boolean;
  environment: ShippingProviderEnvironment;
  displayName: string;
  endpointBaseUrl: string;
  apiBaseUrl: string;
  accountId: string;
  carrierAccountId: string;
  defaultServiceCode: string;
  defaultServiceName: string;
  parcelWeightOz: string;
  parcelLengthIn: string;
  parcelWidthIn: string;
  parcelHeightIn: string;
  webhookSecret: string;
  clearWebhookSecret: boolean;
  apiKey: string;
  clearApiKey: boolean;
};

type ProductLabelPrintAgentConfig = {
  url: string | null;
  hasSharedSecret: boolean;
  sharedSecretHint: string | null;
  updatedAt: string | null;
  effectiveUrl: string | null;
  effectiveSource: "settings" | "environment" | "unconfigured";
  envFallbackUrl: string | null;
  envFallbackHasSharedSecret: boolean;
};

type ProductLabelPrintAgentSettingsResponse = {
  config: ProductLabelPrintAgentConfig;
};

type ProductLabelPrintAgentFormState = {
  url: string;
  sharedSecret: string;
  clearSharedSecret: boolean;
};

type ShippingPrintAgentConfig = {
  url: string | null;
  hasSharedSecret: boolean;
  sharedSecretHint: string | null;
  updatedAt: string | null;
  effectiveUrl: string | null;
  effectiveSource: "settings" | "environment" | "unconfigured";
  envFallbackUrl: string | null;
  envFallbackHasSharedSecret: boolean;
};

type ShippingPrintAgentSettingsResponse = {
  config: ShippingPrintAgentConfig;
};

type ShippingPrintAgentFormState = {
  url: string;
  sharedSecret: string;
  clearSharedSecret: boolean;
};

type BikeTagPrintAgentConfig = {
  url: string | null;
  hasSharedSecret: boolean;
  sharedSecretHint: string | null;
  updatedAt: string | null;
  effectiveUrl: string | null;
  effectiveSource: "settings" | "environment" | "unconfigured";
  envFallbackUrl: string | null;
  envFallbackHasSharedSecret: boolean;
};

type BikeTagPrintAgentSettingsResponse = {
  config: BikeTagPrintAgentConfig;
};

type BikeTagPrintAgentFormState = {
  url: string;
  sharedSecret: string;
  clearSharedSecret: boolean;
};

type ReceiptPrintAgentConfig = {
  url: string | null;
  hasSharedSecret: boolean;
  sharedSecretHint: string | null;
  updatedAt: string | null;
  effectiveUrl: string | null;
  effectiveSource: "settings" | "environment" | "unconfigured";
  envFallbackUrl: string | null;
  envFallbackHasSharedSecret: boolean;
};

type ReceiptPrintAgentSettingsResponse = {
  config: ReceiptPrintAgentConfig;
};

type ReceiptPrintAgentFormState = {
  url: string;
  sharedSecret: string;
  clearSharedSecret: boolean;
};

type ReceiptPrintWorkstation = {
  key: string;
  label: string;
  description: string;
  defaultPrinterId: string | null;
};

type ReceiptPrintWorkstationSettingsResponse = {
  config: {
    updatedAt: string | null;
    workstations: ReceiptPrintWorkstation[];
  };
};

const DEFAULT_WORKSHOP_COMMERCIAL_SETTINGS: WorkshopCommercialSettings = {
  commercialSuggestionsEnabled: true,
  commercialLongGapDays: 180,
  commercialRecentServiceCooldownDays: 60,
};

const DEFAULT_PRINTER_FORM: PrinterFormState = {
  name: "",
  key: "",
  printerFamily: "ZEBRA_LABEL",
  printerModelHint: "GK420D_OR_COMPATIBLE",
  supportsShippingLabels: true,
  supportsProductLabels: false,
  supportsBikeTags: false,
  supportsReceipts: false,
  isActive: true,
  transportMode: "DRY_RUN",
  windowsPrinterName: "",
  rawTcpHost: "",
  rawTcpPort: "9100",
  location: "",
  notes: "",
  setAsDefaultShippingLabel: false,
  setAsDefaultProductLabel: false,
  setAsDefaultBikeTag: false,
  setAsDefaultReceipt: false,
};

const DEFAULT_SHIPPING_PROVIDER_FORM: ShippingProviderFormState = {
  enabled: false,
  environment: "SANDBOX",
  displayName: "",
  endpointBaseUrl: "",
  apiBaseUrl: "",
  accountId: "",
  carrierAccountId: "",
  defaultServiceCode: "",
  defaultServiceName: "",
  parcelWeightOz: "",
  parcelLengthIn: "",
  parcelWidthIn: "",
  parcelHeightIn: "",
  webhookSecret: "",
  clearWebhookSecret: false,
  apiKey: "",
  clearApiKey: false,
};

const DEFAULT_PRODUCT_LABEL_PRINT_AGENT_FORM: ProductLabelPrintAgentFormState = {
  url: "",
  sharedSecret: "",
  clearSharedSecret: false,
};

const DEFAULT_SHIPPING_PRINT_AGENT_FORM: ShippingPrintAgentFormState = {
  url: "",
  sharedSecret: "",
  clearSharedSecret: false,
};

const DEFAULT_BIKE_TAG_PRINT_AGENT_FORM: BikeTagPrintAgentFormState = {
  url: "",
  sharedSecret: "",
  clearSharedSecret: false,
};

const DEFAULT_RECEIPT_PRINT_AGENT_FORM: ReceiptPrintAgentFormState = {
  url: "",
  sharedSecret: "",
  clearSharedSecret: false,
};

const getPrinterCapabilitiesForFamily = (printerFamily: RegisteredPrinterFamily) => ({
  supportsShippingLabels: printerFamily === "ZEBRA_LABEL",
  supportsProductLabels: printerFamily === "DYMO_LABEL",
  supportsBikeTags: printerFamily === "OFFICE_DOCUMENT",
  supportsReceipts: printerFamily === "THERMAL_RECEIPT",
});

const getPrinterModelHintForFamily = (printerFamily: RegisteredPrinterFamily): RegisteredPrinterModelHint =>
  printerFamily === "DYMO_LABEL"
    ? "LABELWRITER_57X32_OR_COMPATIBLE"
    : printerFamily === "OFFICE_DOCUMENT"
      ? "A5_LANDSCAPE_2UP_OR_COMPATIBLE"
      : printerFamily === "THERMAL_RECEIPT"
        ? "ESC_POS_80MM_OR_COMPATIBLE"
      : "GK420D_OR_COMPATIBLE";

const getAllowedTransportModesForFamily = (
  printerFamily: RegisteredPrinterFamily,
): RegisteredPrinterTransportMode[] =>
  printerFamily === "DYMO_LABEL" || printerFamily === "OFFICE_DOCUMENT"
    ? ["DRY_RUN", "WINDOWS_PRINTER"]
    : ["DRY_RUN", "RAW_TCP", "WINDOWS_PRINTER"];

const COMMON_TIME_ZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
];

const COMMON_CURRENCIES = ["GBP", "EUR", "USD", "AUD", "CAD"];

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidUrl = (value: string) => {
  if (!value.trim()) {
    return true;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const normalizeTextInput = (value: string) => value.replace(/\s+/g, " ").trim();
const normalizePostcodeInput = (value: string) => value.replace(/\s+/g, " ").trim().toUpperCase();
const normalizeOpeningHoursTime = (value: string) => value.trim();

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Failed to read logo image"));
    };
    reader.onerror = () => reject(new Error("Failed to read logo image"));
    reader.readAsDataURL(file);
  });

const normalizeOpeningHours = (openingHours: StoreOpeningHours): StoreOpeningHours =>
  STORE_WEEKDAYS.reduce((result, weekday) => {
    const day = openingHours[weekday.key];
    result[weekday.key] = day.isClosed
      ? { isClosed: true, opensAt: "", closesAt: "" }
      : {
        isClosed: false,
        opensAt: normalizeOpeningHoursTime(day.opensAt),
        closesAt: normalizeOpeningHoursTime(day.closesAt),
      };
    return result;
  }, {} as StoreOpeningHours);

const normalizeFormBeforeSave = (
  store: StoreInfo,
): Omit<StoreInfo, "uploadedLogoPath"> => ({
  name: normalizeTextInput(store.name),
  businessName: normalizeTextInput(store.businessName),
  email: store.email.trim().toLowerCase(),
  phone: store.phone.trim(),
  website: store.website.trim(),
  addressLine1: normalizeTextInput(store.addressLine1),
  addressLine2: normalizeTextInput(store.addressLine2),
  city: normalizeTextInput(store.city),
  region: normalizeTextInput(store.region),
  postcode: normalizePostcodeInput(store.postcode),
  country: normalizeTextInput(store.country),
  vatNumber: store.vatNumber.trim(),
  companyNumber: store.companyNumber.trim(),
  defaultCurrency: store.defaultCurrency.trim().toUpperCase(),
  timeZone: store.timeZone.trim(),
  logoUrl: store.logoUrl.trim(),
  footerText: store.footerText.trim(),
  openingHours: normalizeOpeningHours(store.openingHours),
});

const toOpeningHoursFormState = (value: unknown): StoreOpeningHours => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_OPENING_HOURS;
  }

  const record = value as Record<string, unknown>;
  return STORE_WEEKDAYS.reduce((result, weekday) => {
    const rawDay = record[weekday.key];
    if (!rawDay || typeof rawDay !== "object" || Array.isArray(rawDay)) {
      result[weekday.key] = DEFAULT_OPENING_HOURS[weekday.key];
      return result;
    }

    const dayRecord = rawDay as Record<string, unknown>;
    result[weekday.key] = {
      isClosed: typeof dayRecord.isClosed === "boolean" ? dayRecord.isClosed : DEFAULT_OPENING_HOURS[weekday.key].isClosed,
      opensAt: typeof dayRecord.opensAt === "string" ? dayRecord.opensAt : DEFAULT_OPENING_HOURS[weekday.key].opensAt,
      closesAt: typeof dayRecord.closesAt === "string" ? dayRecord.closesAt : DEFAULT_OPENING_HOURS[weekday.key].closesAt,
    };
    return result;
  }, {} as StoreOpeningHours);
};

const toStoreInfoFormState = (store: Record<string, unknown>): StoreInfo => ({
  name: typeof store.name === "string" ? store.name : "",
  businessName: typeof store.businessName === "string" ? store.businessName : "",
  email: typeof store.email === "string" ? store.email : "",
  phone: typeof store.phone === "string" ? store.phone : "",
  website: typeof store.website === "string" ? store.website : "",
  addressLine1: typeof store.addressLine1 === "string" ? store.addressLine1 : "",
  addressLine2: typeof store.addressLine2 === "string" ? store.addressLine2 : "",
  city: typeof store.city === "string" ? store.city : "",
  region: typeof store.region === "string" ? store.region : "",
  postcode: typeof store.postcode === "string" ? store.postcode : "",
  country: typeof store.country === "string" ? store.country : "",
  vatNumber: typeof store.vatNumber === "string" ? store.vatNumber : "",
  companyNumber: typeof store.companyNumber === "string" ? store.companyNumber : "",
  defaultCurrency: typeof store.defaultCurrency === "string" ? store.defaultCurrency : "",
  timeZone: typeof store.timeZone === "string" ? store.timeZone : "",
  logoUrl: typeof store.logoUrl === "string" ? store.logoUrl : "",
  uploadedLogoPath: typeof store.uploadedLogoPath === "string" ? store.uploadedLogoPath : "",
  footerText: typeof store.footerText === "string" ? store.footerText : "",
  openingHours: toOpeningHoursFormState(store.openingHours),
});

const toWorkshopCommercialSettings = (value: unknown): WorkshopCommercialSettings => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_WORKSHOP_COMMERCIAL_SETTINGS;
  }

  const record = value as Record<string, unknown>;
  return {
    commercialSuggestionsEnabled:
      typeof record.commercialSuggestionsEnabled === "boolean"
        ? record.commercialSuggestionsEnabled
        : DEFAULT_WORKSHOP_COMMERCIAL_SETTINGS.commercialSuggestionsEnabled,
    commercialLongGapDays:
      typeof record.commercialLongGapDays === "number" && Number.isInteger(record.commercialLongGapDays)
        ? record.commercialLongGapDays
        : DEFAULT_WORKSHOP_COMMERCIAL_SETTINGS.commercialLongGapDays,
    commercialRecentServiceCooldownDays:
      typeof record.commercialRecentServiceCooldownDays === "number"
        && Number.isInteger(record.commercialRecentServiceCooldownDays)
        ? record.commercialRecentServiceCooldownDays
        : DEFAULT_WORKSHOP_COMMERCIAL_SETTINGS.commercialRecentServiceCooldownDays,
  };
};

const toPrinterFormState = (
  printer: RegisteredPrinter | null,
  defaultShippingLabelPrinterId: string | null,
  defaultProductLabelPrinterId: string | null,
  defaultBikeTagPrinterId: string | null,
  defaultReceiptPrinterId: string | null,
): PrinterFormState => {
  if (!printer) {
    return DEFAULT_PRINTER_FORM;
  }

  return {
    name: printer.name,
    key: printer.key,
    printerFamily: printer.printerFamily,
    printerModelHint: printer.printerModelHint,
    supportsShippingLabels: printer.supportsShippingLabels,
    supportsProductLabels: printer.supportsProductLabels,
    supportsBikeTags: printer.supportsBikeTags,
    supportsReceipts: printer.supportsReceipts,
    isActive: printer.isActive,
    transportMode: printer.transportMode,
    windowsPrinterName: printer.windowsPrinterName ?? "",
    rawTcpHost: printer.rawTcpHost ?? "",
    rawTcpPort: printer.rawTcpPort ? String(printer.rawTcpPort) : "9100",
    location: printer.location ?? "",
    notes: printer.notes ?? "",
    setAsDefaultShippingLabel: printer.id === defaultShippingLabelPrinterId,
    setAsDefaultProductLabel: printer.id === defaultProductLabelPrinterId,
    setAsDefaultBikeTag: printer.id === defaultBikeTagPrinterId,
    setAsDefaultReceipt: printer.id === defaultReceiptPrinterId,
  };
};

const toShippingProviderFormState = (
  provider: ShippingProviderSettings | null,
): ShippingProviderFormState => {
  if (!provider?.configuration) {
    return DEFAULT_SHIPPING_PROVIDER_FORM;
  }

  return {
    enabled: provider.configuration.enabled,
    environment: provider.configuration.environment,
    displayName: provider.configuration.displayName ?? "",
    endpointBaseUrl: provider.configuration.endpointBaseUrl ?? "",
    apiBaseUrl: provider.configuration.apiBaseUrl ?? "",
    accountId: provider.configuration.accountId ?? "",
    carrierAccountId: provider.configuration.carrierAccountId ?? "",
    defaultServiceCode: provider.configuration.defaultServiceCode ?? "",
    defaultServiceName: provider.configuration.defaultServiceName ?? "",
    parcelWeightOz: provider.configuration.parcelWeightOz ? String(provider.configuration.parcelWeightOz) : "",
    parcelLengthIn: provider.configuration.parcelLengthIn ? String(provider.configuration.parcelLengthIn) : "",
    parcelWidthIn: provider.configuration.parcelWidthIn ? String(provider.configuration.parcelWidthIn) : "",
    parcelHeightIn: provider.configuration.parcelHeightIn ? String(provider.configuration.parcelHeightIn) : "",
    webhookSecret: "",
    clearWebhookSecret: false,
    apiKey: "",
    clearApiKey: false,
  };
};

const toProductLabelPrintAgentFormState = (
  config: ProductLabelPrintAgentConfig | null,
): ProductLabelPrintAgentFormState => ({
  url: config?.url ?? "",
  sharedSecret: "",
  clearSharedSecret: false,
});

const toShippingPrintAgentFormState = (
  config: ShippingPrintAgentConfig | null,
): ShippingPrintAgentFormState => ({
  url: config?.url ?? "",
  sharedSecret: "",
  clearSharedSecret: false,
});

const toBikeTagPrintAgentFormState = (
  config: BikeTagPrintAgentConfig | null,
): BikeTagPrintAgentFormState => ({
  url: config?.url ?? "",
  sharedSecret: "",
  clearSharedSecret: false,
});

const toReceiptPrintAgentFormState = (
  config: ReceiptPrintAgentConfig | null,
): ReceiptPrintAgentFormState => ({
  url: config?.url ?? "",
  sharedSecret: "",
  clearSharedSecret: false,
});

const formatManagedPrintWorkflowLabel = (workflowType: ManagedPrintWorkflowType) => {
  switch (workflowType) {
    case "RECEIPT_PRINT":
      return "Receipt";
    case "SHIPMENT_LABEL_PRINT":
      return "Shipment label";
    case "PRODUCT_LABEL_PRINT":
      return "Product label";
    case "BIKE_TAG_PRINT":
      return "Bike tag";
  }
};

const formatManagedPrintTimestamp = (value: string | null) => {
  if (!value) {
    return "Not started";
  }
  return new Date(value).toLocaleString();
};

type SystemSettingsPageMode = "store-info" | "printers" | "workshop" | "shipping";

type SystemSettingsPageProps = {
  mode?: SystemSettingsPageMode;
};

export const SystemSettingsPage = ({ mode = "store-info" }: SystemSettingsPageProps) => {
  const isStoreInfoMode = mode === "store-info";
  const isPrintersMode = mode === "printers";
  const isWorkshopSettingsMode = mode === "workshop";
  const isShippingSettingsMode = mode === "shipping";
  const { error, success } = useToasts();
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [initialStore, setInitialStore] = useState<StoreInfo | null>(null);
  const [selectedLogoFile, setSelectedLogoFile] = useState<File | null>(null);
  const [workshopCommercial, setWorkshopCommercial] = useState<WorkshopCommercialSettings | null>(null);
  const [initialWorkshopCommercial, setInitialWorkshopCommercial] = useState<WorkshopCommercialSettings | null>(null);
  const [providerSettingsPayload, setProviderSettingsPayload] = useState<ShippingProviderSettingsListResponse | null>(null);
  const [selectedProviderKey, setSelectedProviderKey] = useState("");
  const [providerForm, setProviderForm] = useState<ShippingProviderFormState>(DEFAULT_SHIPPING_PROVIDER_FORM);
  const [shippingPrintAgentConfig, setShippingPrintAgentConfig] = useState<ShippingPrintAgentConfig | null>(null);
  const [shippingPrintAgentForm, setShippingPrintAgentForm] = useState<ShippingPrintAgentFormState>(
    DEFAULT_SHIPPING_PRINT_AGENT_FORM,
  );
  const [bikeTagPrintAgentConfig, setBikeTagPrintAgentConfig] = useState<BikeTagPrintAgentConfig | null>(null);
  const [bikeTagPrintAgentForm, setBikeTagPrintAgentForm] = useState<BikeTagPrintAgentFormState>(
    DEFAULT_BIKE_TAG_PRINT_AGENT_FORM,
  );
  const [receiptPrintAgentConfig, setReceiptPrintAgentConfig] = useState<ReceiptPrintAgentConfig | null>(null);
  const [receiptPrintAgentForm, setReceiptPrintAgentForm] = useState<ReceiptPrintAgentFormState>(
    DEFAULT_RECEIPT_PRINT_AGENT_FORM,
  );
  const [productLabelPrintAgentConfig, setProductLabelPrintAgentConfig] = useState<ProductLabelPrintAgentConfig | null>(null);
  const [productLabelPrintAgentForm, setProductLabelPrintAgentForm] = useState<ProductLabelPrintAgentFormState>(
    DEFAULT_PRODUCT_LABEL_PRINT_AGENT_FORM,
  );
  const [receiptWorkstations, setReceiptWorkstations] = useState<ReceiptPrintWorkstation[]>([]);
  const [managedPrintJobs, setManagedPrintJobs] = useState<ManagedPrintJobSummary[]>([]);
  const [browserReceiptWorkstationKey, setBrowserReceiptWorkstationKey] = useState<string>(
    () => getStoredReceiptWorkstationKey() ?? "",
  );
  const [printersPayload, setPrintersPayload] = useState<RegisteredPrinterListResponse | null>(null);
  const [selectedPrinterId, setSelectedPrinterId] = useState("");
  const [printerForm, setPrinterForm] = useState<PrinterFormState>(DEFAULT_PRINTER_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [savingWorkshopCommercial, setSavingWorkshopCommercial] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const [settingDefaultProvider, setSettingDefaultProvider] = useState(false);
  const [savingShippingPrintAgent, setSavingShippingPrintAgent] = useState(false);
  const [savingBikeTagPrintAgent, setSavingBikeTagPrintAgent] = useState(false);
  const [savingReceiptPrintAgent, setSavingReceiptPrintAgent] = useState(false);
  const [savingProductLabelPrintAgent, setSavingProductLabelPrintAgent] = useState(false);
  const [savingPrinter, setSavingPrinter] = useState(false);
  const [settingDefaultPrinter, setSettingDefaultPrinter] = useState(false);
  const [savingReceiptWorkstations, setSavingReceiptWorkstations] = useState(false);
  const [loadingManagedPrintJobs, setLoadingManagedPrintJobs] = useState(true);
  const [retryingManagedPrintJobId, setRetryingManagedPrintJobId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [
          storePayload,
          settingsPayload,
          providerSettingsResponse,
          shippingPrintAgentResponse,
          bikeTagPrintAgentResponse,
          receiptPrintAgentResponse,
          productLabelPrintAgentResponse,
          receiptWorkstationsResponse,
          printersResponse,
          managedPrintJobsResponse,
        ] = await Promise.all([
          apiGet<StoreInfoResponse>("/api/settings/store-info"),
          apiGet<SettingsResponse>("/api/settings"),
          apiGet<ShippingProviderSettingsListResponse>("/api/settings/shipping-providers"),
          apiGet<ShippingPrintAgentSettingsResponse>("/api/settings/shipping-print-agent"),
          apiGet<BikeTagPrintAgentSettingsResponse>("/api/settings/bike-tag-print-agent"),
          apiGet<ReceiptPrintAgentSettingsResponse>("/api/settings/receipt-print-agent"),
          apiGet<ProductLabelPrintAgentSettingsResponse>("/api/settings/product-label-print-agent"),
          apiGet<ReceiptPrintWorkstationSettingsResponse>("/api/settings/receipt-workstations"),
          apiGet<RegisteredPrinterListResponse>("/api/settings/printers"),
          listManagedPrintJobs({
            status: ["PENDING", "PROCESSING", "FAILED"],
            take: 30,
          }),
        ]);
        if (cancelled) {
          return;
        }
        const normalizedStore = toStoreInfoFormState(
          storePayload.store as unknown as Record<string, unknown>,
        );
        const normalizedWorkshopCommercial = toWorkshopCommercialSettings(
          settingsPayload.settings?.workshop as unknown as Record<string, unknown>,
        );
        setStore(normalizedStore);
        setInitialStore(normalizedStore);
        setWorkshopCommercial(normalizedWorkshopCommercial);
        setInitialWorkshopCommercial(normalizedWorkshopCommercial);
        setProviderSettingsPayload(providerSettingsResponse);
        const preferredProviderKey =
          providerSettingsResponse.defaultProviderKey
          || providerSettingsResponse.providers[0]?.key
          || "";
        setSelectedProviderKey(preferredProviderKey);
        setProviderForm(
          toShippingProviderFormState(
            providerSettingsResponse.providers.find((provider) => provider.key === preferredProviderKey) ?? null,
          ),
        );
        setShippingPrintAgentConfig(shippingPrintAgentResponse.config);
        setShippingPrintAgentForm(toShippingPrintAgentFormState(shippingPrintAgentResponse.config));
        setBikeTagPrintAgentConfig(bikeTagPrintAgentResponse.config);
        setBikeTagPrintAgentForm(toBikeTagPrintAgentFormState(bikeTagPrintAgentResponse.config));
        setReceiptPrintAgentConfig(receiptPrintAgentResponse.config);
        setReceiptPrintAgentForm(toReceiptPrintAgentFormState(receiptPrintAgentResponse.config));
        setProductLabelPrintAgentConfig(productLabelPrintAgentResponse.config);
        setProductLabelPrintAgentForm(toProductLabelPrintAgentFormState(productLabelPrintAgentResponse.config));
        setReceiptWorkstations(receiptWorkstationsResponse.config.workstations);
        setPrintersPayload(printersResponse);
        setManagedPrintJobs(managedPrintJobsResponse.jobs);
        const preferredPrinterId =
          printersResponse.defaultBikeTagPrinterId
          ?? printersResponse.defaultReceiptPrinterId
          ?? printersResponse.defaultShippingLabelPrinterId
          ?? printersResponse.defaultProductLabelPrinterId
          ?? printersResponse.printers[0]?.id
          ?? "";
        setSelectedPrinterId(preferredPrinterId);
        setPrinterForm(
          toPrinterFormState(
            printersResponse.printers.find((printer) => printer.id === preferredPrinterId) ?? null,
            printersResponse.defaultShippingLabelPrinterId,
            printersResponse.defaultProductLabelPrinterId,
            printersResponse.defaultBikeTagPrinterId,
            printersResponse.defaultReceiptPrinterId,
          ),
        );
      } catch (loadError) {
        if (!cancelled) {
          error(loadError instanceof Error ? loadError.message : "Failed to load settings");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadingManagedPrintJobs(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [error]);

  const validationErrors = useMemo(() => {
    if (!store) {
      return {
        fields: {},
        openingHours: {},
      };
    }

    const errors: Partial<Record<keyof StoreInfo, string>> = {};
    const openingHoursErrors: Partial<Record<StoreWeekdayKey, string>> = {};

    if (!store.name.trim()) {
      errors.name = "Store name is required.";
    }
    if (!store.businessName.trim()) {
      errors.businessName = "Business / trading name is required.";
    }
    if (store.email.trim() && !emailRegex.test(store.email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (store.website.trim() && !isValidUrl(store.website)) {
      errors.website = "Website must start with http:// or https://";
    }
    if (!store.addressLine1.trim()) {
      errors.addressLine1 = "Address line 1 is required.";
    }
    if (!store.city.trim()) {
      errors.city = "City / town is required.";
    }
    if (!store.postcode.trim()) {
      errors.postcode = "Postcode is required.";
    }
    if (!store.country.trim()) {
      errors.country = "Country is required.";
    }
    if (!/^[A-Z]{3}$/i.test(store.defaultCurrency.trim())) {
      errors.defaultCurrency = "Use a 3-letter currency code such as GBP.";
    }
    if (!store.timeZone.trim()) {
      errors.timeZone = "Time zone is required.";
    }
    if (store.logoUrl.trim() && !isValidUrl(store.logoUrl)) {
      errors.logoUrl = "Logo URL must start with http:// or https://";
    }

    for (const weekday of STORE_WEEKDAYS) {
      const day = store.openingHours[weekday.key];
      if (day.isClosed) {
        continue;
      }
      if (!day.opensAt || !day.closesAt) {
        openingHoursErrors[weekday.key] = "Opening and closing times are required.";
        continue;
      }
      if (day.opensAt >= day.closesAt) {
        openingHoursErrors[weekday.key] = "Opening time must be earlier than closing time.";
      }
    }

    return {
      fields: errors,
      openingHours: openingHoursErrors,
    };
  }, [store]);

  const isDirty = useMemo(() => {
    if (!store || !initialStore) {
      return false;
    }

    return JSON.stringify(store) !== JSON.stringify(initialStore);
  }, [initialStore, store]);

  const hasValidationErrors = Object.keys(validationErrors.fields).length > 0
    || Object.keys(validationErrors.openingHours).length > 0;
  const preferredLogoUrl = store
    ? (store.uploadedLogoPath || (isValidUrl(store.logoUrl) ? store.logoUrl.trim() : ""))
    : "";
  const isUsingUploadedLogo = Boolean(store?.uploadedLogoPath);

  const workshopCommercialValidationErrors = useMemo(() => {
    if (!workshopCommercial) {
      return {};
    }

    const errors: Partial<Record<keyof WorkshopCommercialSettings, string>> = {};

    if (
      !Number.isInteger(workshopCommercial.commercialLongGapDays)
      || workshopCommercial.commercialLongGapDays < 30
      || workshopCommercial.commercialLongGapDays > 1095
    ) {
      errors.commercialLongGapDays = "Use a whole number of days between 30 and 1095.";
    }

    if (
      !Number.isInteger(workshopCommercial.commercialRecentServiceCooldownDays)
      || workshopCommercial.commercialRecentServiceCooldownDays < 0
      || workshopCommercial.commercialRecentServiceCooldownDays > 365
    ) {
      errors.commercialRecentServiceCooldownDays = "Use a whole number of days between 0 and 365.";
    }

    if (
      Number.isInteger(workshopCommercial.commercialLongGapDays)
      && Number.isInteger(workshopCommercial.commercialRecentServiceCooldownDays)
      && workshopCommercial.commercialLongGapDays < workshopCommercial.commercialRecentServiceCooldownDays
    ) {
      errors.commercialLongGapDays = "Long-gap timing should be equal to or greater than the recent-service cooldown.";
    }

    return errors;
  }, [workshopCommercial]);

  const workshopCommercialDirty = useMemo(() => {
    if (!workshopCommercial || !initialWorkshopCommercial) {
      return false;
    }

    return JSON.stringify(workshopCommercial) !== JSON.stringify(initialWorkshopCommercial);
  }, [initialWorkshopCommercial, workshopCommercial]);

  const hasWorkshopCommercialValidationErrors = Object.keys(workshopCommercialValidationErrors).length > 0;
  const selectedProvider = useMemo(
    () => providerSettingsPayload?.providers.find((provider) => provider.key === selectedProviderKey) ?? null,
    [providerSettingsPayload?.providers, selectedProviderKey],
  );
  const selectedProviderIsEasyPost = selectedProvider?.key === "EASYPOST";
  const providerValidationErrors = useMemo(() => {
    const errors: Partial<Record<keyof ShippingProviderFormState, string>> = {};
    if (!selectedProvider?.requiresConfiguration) {
      return errors;
    }

    const hasStoredApiKey = Boolean(selectedProvider.configuration?.hasApiKey);
    const needsReplacementApiKey = providerForm.clearApiKey && providerForm.enabled && !providerForm.apiKey.trim();

    const parsePositiveNumberInput = (value: string) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };

    if (providerForm.enabled) {
      if (selectedProvider.key === "GENERIC_HTTP_ZPL") {
        if (!providerForm.endpointBaseUrl.trim()) {
          errors.endpointBaseUrl = "Enabled providers need an endpoint URL.";
        } else if (!isValidUrl(providerForm.endpointBaseUrl)) {
          errors.endpointBaseUrl = "Endpoint URL must start with http:// or https://";
        }
      }

      if (selectedProvider.key === "EASYPOST") {
        if (providerForm.apiBaseUrl.trim() && !isValidUrl(providerForm.apiBaseUrl)) {
          errors.apiBaseUrl = "API base URL must start with http:// or https://";
        }
        if (!providerForm.carrierAccountId.trim()) {
          errors.carrierAccountId = "Carrier account ID is required for EasyPost.";
        }
        if (!providerForm.defaultServiceCode.trim()) {
          errors.defaultServiceCode = "Default service code is required for EasyPost.";
        }
        if (!parsePositiveNumberInput(providerForm.parcelWeightOz)) {
          errors.parcelWeightOz = "Parcel weight must be a positive number of ounces.";
        }
        if (!parsePositiveNumberInput(providerForm.parcelLengthIn)) {
          errors.parcelLengthIn = "Parcel length must be a positive number of inches.";
        }
        if (!parsePositiveNumberInput(providerForm.parcelWidthIn)) {
          errors.parcelWidthIn = "Parcel width must be a positive number of inches.";
        }
        if (!parsePositiveNumberInput(providerForm.parcelHeightIn)) {
          errors.parcelHeightIn = "Parcel height must be a positive number of inches.";
        }
      }

      if (!hasStoredApiKey && !providerForm.apiKey.trim()) {
        errors.apiKey = "Provide an API key before enabling this provider.";
      }
      if (needsReplacementApiKey) {
        errors.apiKey = "Enter a replacement API key or untick clear API key.";
      }
    } else {
      if (providerForm.endpointBaseUrl.trim() && !isValidUrl(providerForm.endpointBaseUrl)) {
        errors.endpointBaseUrl = "Endpoint URL must start with http:// or https://";
      }
      if (providerForm.apiBaseUrl.trim() && !isValidUrl(providerForm.apiBaseUrl)) {
        errors.apiBaseUrl = "API base URL must start with http:// or https://";
      }
    }

    return errors;
  }, [providerForm, selectedProvider]);
  const hasProviderValidationErrors = Object.keys(providerValidationErrors).length > 0;
  const shippingPrintAgentValidationErrors = useMemo(() => {
    const errors: Partial<Record<keyof ShippingPrintAgentFormState, string>> = {};

    if (shippingPrintAgentForm.url.trim() && !isValidUrl(shippingPrintAgentForm.url)) {
      errors.url = "Helper URL must start with http:// or https://";
    }
    if (
      shippingPrintAgentForm.clearSharedSecret
      && shippingPrintAgentForm.sharedSecret.trim().length > 0
    ) {
      errors.sharedSecret = "Enter a new shared secret or clear the stored secret, not both.";
    }

    return errors;
  }, [shippingPrintAgentForm]);
  const hasShippingPrintAgentValidationErrors = Object.keys(shippingPrintAgentValidationErrors).length > 0;
  const bikeTagPrintAgentValidationErrors = useMemo(() => {
    const errors: Partial<Record<keyof BikeTagPrintAgentFormState, string>> = {};

    if (bikeTagPrintAgentForm.url.trim() && !isValidUrl(bikeTagPrintAgentForm.url)) {
      errors.url = "Helper URL must start with http:// or https://";
    }
    if (
      bikeTagPrintAgentForm.clearSharedSecret
      && bikeTagPrintAgentForm.sharedSecret.trim().length > 0
    ) {
      errors.sharedSecret = "Enter a new shared secret or clear the stored secret, not both.";
    }

    return errors;
  }, [bikeTagPrintAgentForm]);
  const hasBikeTagPrintAgentValidationErrors = Object.keys(bikeTagPrintAgentValidationErrors).length > 0;
  const receiptPrintAgentValidationErrors = useMemo(() => {
    const errors: Partial<Record<keyof ReceiptPrintAgentFormState, string>> = {};

    if (receiptPrintAgentForm.url.trim() && !isValidUrl(receiptPrintAgentForm.url)) {
      errors.url = "Helper URL must start with http:// or https://";
    }
    if (
      receiptPrintAgentForm.clearSharedSecret
      && receiptPrintAgentForm.sharedSecret.trim().length > 0
    ) {
      errors.sharedSecret = "Enter a new shared secret or clear the stored secret, not both.";
    }

    return errors;
  }, [receiptPrintAgentForm]);
  const hasReceiptPrintAgentValidationErrors = Object.keys(receiptPrintAgentValidationErrors).length > 0;
  const productLabelPrintAgentValidationErrors = useMemo(() => {
    const errors: Partial<Record<keyof ProductLabelPrintAgentFormState, string>> = {};

    if (productLabelPrintAgentForm.url.trim() && !isValidUrl(productLabelPrintAgentForm.url)) {
      errors.url = "Helper URL must start with http:// or https://";
    }
    if (
      productLabelPrintAgentForm.clearSharedSecret
      && productLabelPrintAgentForm.sharedSecret.trim().length > 0
    ) {
      errors.sharedSecret = "Enter a new shared secret or clear the stored secret, not both.";
    }

    return errors;
  }, [productLabelPrintAgentForm]);
  const hasProductLabelPrintAgentValidationErrors = Object.keys(productLabelPrintAgentValidationErrors).length > 0;
  const selectedPrinter = useMemo(
    () => printersPayload?.printers.find((printer) => printer.id === selectedPrinterId) ?? null,
    [printersPayload?.printers, selectedPrinterId],
  );
  const receiptCapablePrinters = useMemo(
    () => printersPayload?.printers.filter((printer) => printer.supportsReceipts && printer.isActive) ?? [],
    [printersPayload?.printers],
  );
  const allowedPrinterTransportModes = useMemo(
    () => getAllowedTransportModesForFamily(printerForm.printerFamily),
    [printerForm.printerFamily],
  );
  const printerFamilyCapabilities = useMemo(
    () => getPrinterCapabilitiesForFamily(printerForm.printerFamily),
    [printerForm.printerFamily],
  );
  const printerValidationErrors = useMemo(() => {
    const errors: Partial<Record<keyof PrinterFormState, string>> = {};

    if (!printerForm.name.trim()) {
      errors.name = "Printer name is required.";
    }
    if (!printerForm.key.trim()) {
      errors.key = "Printer key is required.";
    } else if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(printerForm.key.trim())) {
      errors.key = "Use letters, numbers, underscores, or hyphens.";
    }
    if (!allowedPrinterTransportModes.includes(printerForm.transportMode)) {
      errors.transportMode = "Choose a transport mode supported by this printer family.";
    }
    if (printerForm.transportMode === "RAW_TCP") {
      if (!printerForm.rawTcpHost.trim()) {
        errors.rawTcpHost = "RAW_TCP printers need a host.";
      }
      const parsedPort = Number.parseInt(printerForm.rawTcpPort, 10);
      if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
        errors.rawTcpPort = "Use a port between 1 and 65535.";
      }
    }
    if (printerForm.transportMode === "WINDOWS_PRINTER" && !printerForm.windowsPrinterName.trim()) {
      errors.windowsPrinterName = "Enter the installed Windows printer name for managed printing.";
    }

    return errors;
  }, [allowedPrinterTransportModes, printerForm]);
  const hasPrinterValidationErrors = Object.keys(printerValidationErrors).length > 0;

  const setField = <K extends keyof StoreInfo>(key: K, value: StoreInfo[K]) => {
    setStore((current) => (current ? { ...current, [key]: value } : current));
  };

  const setPrinterField = <K extends keyof PrinterFormState>(key: K, value: PrinterFormState[K]) => {
    setPrinterForm((current) => ({ ...current, [key]: value }));
  };

  const setPrinterFamily = (printerFamily: RegisteredPrinterFamily) => {
    setPrinterForm((current) => {
      const allowedTransportModes = getAllowedTransportModesForFamily(printerFamily);
      const nextTransportMode = allowedTransportModes.includes(current.transportMode)
        ? current.transportMode
        : "DRY_RUN";
      const capabilities = getPrinterCapabilitiesForFamily(printerFamily);

      return {
        ...current,
        printerFamily,
        printerModelHint: getPrinterModelHintForFamily(printerFamily),
        supportsShippingLabels: capabilities.supportsShippingLabels,
        supportsProductLabels: capabilities.supportsProductLabels,
        supportsBikeTags: capabilities.supportsBikeTags,
        supportsReceipts: capabilities.supportsReceipts,
        transportMode: nextTransportMode,
        windowsPrinterName:
          nextTransportMode === "WINDOWS_PRINTER"
            ? current.windowsPrinterName || current.name
            : "",
        rawTcpHost: nextTransportMode === "RAW_TCP" ? current.rawTcpHost : "",
        rawTcpPort: nextTransportMode === "RAW_TCP" ? current.rawTcpPort || "9100" : "9100",
        setAsDefaultShippingLabel: capabilities.supportsShippingLabels ? current.setAsDefaultShippingLabel : false,
        setAsDefaultProductLabel: capabilities.supportsProductLabels ? current.setAsDefaultProductLabel : false,
        setAsDefaultBikeTag: capabilities.supportsBikeTags ? current.setAsDefaultBikeTag : false,
        setAsDefaultReceipt: capabilities.supportsReceipts ? current.setAsDefaultReceipt : false,
      };
    });
  };

  const setProviderField = <K extends keyof ShippingProviderFormState>(
    key: K,
    value: ShippingProviderFormState[K],
  ) => {
    setProviderForm((current) => ({ ...current, [key]: value }));
  };

  const setShippingPrintAgentField = <K extends keyof ShippingPrintAgentFormState>(
    key: K,
    value: ShippingPrintAgentFormState[K],
  ) => {
    setShippingPrintAgentForm((current) => ({ ...current, [key]: value }));
  };

  const setBikeTagPrintAgentField = <K extends keyof BikeTagPrintAgentFormState>(
    key: K,
    value: BikeTagPrintAgentFormState[K],
  ) => {
    setBikeTagPrintAgentForm((current) => ({ ...current, [key]: value }));
  };

  const setReceiptPrintAgentField = <K extends keyof ReceiptPrintAgentFormState>(
    key: K,
    value: ReceiptPrintAgentFormState[K],
  ) => {
    setReceiptPrintAgentForm((current) => ({ ...current, [key]: value }));
  };

  const setProductLabelPrintAgentField = <K extends keyof ProductLabelPrintAgentFormState>(
    key: K,
    value: ProductLabelPrintAgentFormState[K],
  ) => {
    setProductLabelPrintAgentForm((current) => ({ ...current, [key]: value }));
  };

  const setWorkshopCommercialField = <K extends keyof WorkshopCommercialSettings>(
    key: K,
    value: WorkshopCommercialSettings[K],
  ) => {
    setWorkshopCommercial((current) => (current ? { ...current, [key]: value } : current));
  };

  const setOpeningHours = (weekday: StoreWeekdayKey, patch: Partial<StoreDailyOpeningHours>) => {
    setStore((current) => {
      if (!current) {
        return current;
      }

      const currentDay = current.openingHours[weekday];
      const nextDay = {
        ...currentDay,
        ...patch,
      };

      return {
        ...current,
        openingHours: {
          ...current.openingHours,
          [weekday]: nextDay.isClosed
            ? { isClosed: true, opensAt: "", closesAt: "" }
            : {
              isClosed: false,
              opensAt: nextDay.opensAt || DEFAULT_OPENING_HOURS[weekday].opensAt,
              closesAt: nextDay.closesAt || DEFAULT_OPENING_HOURS[weekday].closesAt,
            },
        },
      };
    });
  };

  const loadPrinters = async (preferredPrinterId?: string) => {
    const payload = await apiGet<RegisteredPrinterListResponse>("/api/settings/printers");
    setPrintersPayload(payload);
    const nextPrinterId =
      preferredPrinterId
      ?? payload.defaultBikeTagPrinterId
      ?? payload.defaultReceiptPrinterId
      ?? payload.defaultShippingLabelPrinterId
      ?? payload.defaultProductLabelPrinterId
      ?? payload.printers[0]?.id
      ?? "";
    setSelectedPrinterId(nextPrinterId);
    setPrinterForm(
      toPrinterFormState(
        payload.printers.find((printer) => printer.id === nextPrinterId) ?? null,
        payload.defaultShippingLabelPrinterId,
        payload.defaultProductLabelPrinterId,
        payload.defaultBikeTagPrinterId,
        payload.defaultReceiptPrinterId,
      ),
    );
    return payload;
  };

  const loadShippingProviders = async (preferredProviderKey?: string) => {
    const payload = await apiGet<ShippingProviderSettingsListResponse>("/api/settings/shipping-providers");
    setProviderSettingsPayload(payload);
    const nextProviderKey =
      preferredProviderKey
      ?? payload.defaultProviderKey
      ?? payload.providers[0]?.key
      ?? "";
    setSelectedProviderKey(nextProviderKey);
    setProviderForm(
      toShippingProviderFormState(
        payload.providers.find((provider) => provider.key === nextProviderKey) ?? null,
      ),
    );
    return payload;
  };

  const loadProductLabelPrintAgentSettings = async () => {
    const payload = await apiGet<ProductLabelPrintAgentSettingsResponse>("/api/settings/product-label-print-agent");
    setProductLabelPrintAgentConfig(payload.config);
    setProductLabelPrintAgentForm(toProductLabelPrintAgentFormState(payload.config));
    return payload;
  };

  const loadShippingPrintAgentSettings = async () => {
    const payload = await apiGet<ShippingPrintAgentSettingsResponse>("/api/settings/shipping-print-agent");
    setShippingPrintAgentConfig(payload.config);
    setShippingPrintAgentForm(toShippingPrintAgentFormState(payload.config));
    return payload;
  };

  const loadBikeTagPrintAgentSettings = async () => {
    const payload = await apiGet<BikeTagPrintAgentSettingsResponse>("/api/settings/bike-tag-print-agent");
    setBikeTagPrintAgentConfig(payload.config);
    setBikeTagPrintAgentForm(toBikeTagPrintAgentFormState(payload.config));
    return payload;
  };

  const loadReceiptPrintAgentSettings = async () => {
    const payload = await apiGet<ReceiptPrintAgentSettingsResponse>("/api/settings/receipt-print-agent");
    setReceiptPrintAgentConfig(payload.config);
    setReceiptPrintAgentForm(toReceiptPrintAgentFormState(payload.config));
    return payload;
  };

  const loadReceiptWorkstations = async () => {
    const payload = await apiGet<ReceiptPrintWorkstationSettingsResponse>("/api/settings/receipt-workstations");
    setReceiptWorkstations(payload.config.workstations);
    return payload;
  };

  const loadManagedPrintJobs = async () => {
    setLoadingManagedPrintJobs(true);
    try {
      const payload = await listManagedPrintJobs({
        status: ["PENDING", "PROCESSING", "FAILED"],
        take: 30,
      });
      setManagedPrintJobs(payload.jobs);
      return payload;
    } finally {
      setLoadingManagedPrintJobs(false);
    }
  };

  const selectShippingProviderForEditing = (providerKey: string) => {
    const provider = providerSettingsPayload?.providers.find((candidate) => candidate.key === providerKey) ?? null;
    setSelectedProviderKey(providerKey);
    setProviderForm(toShippingProviderFormState(provider));
  };

  const selectPrinterForEditing = (printerId: string) => {
    const printer = printersPayload?.printers.find((candidate) => candidate.id === printerId) ?? null;
    setSelectedPrinterId(printerId);
    setPrinterForm(
      toPrinterFormState(
        printer,
        printersPayload?.defaultShippingLabelPrinterId ?? null,
        printersPayload?.defaultProductLabelPrinterId ?? null,
        printersPayload?.defaultBikeTagPrinterId ?? null,
        printersPayload?.defaultReceiptPrinterId ?? null,
      ),
    );
  };

  const resetPrinterForm = () => {
    setSelectedPrinterId("");
    setPrinterForm({
      ...DEFAULT_PRINTER_FORM,
      setAsDefaultShippingLabel: printersPayload?.defaultShippingLabelPrinterId === null,
      setAsDefaultProductLabel: printersPayload?.defaultProductLabelPrinterId === null,
      setAsDefaultBikeTag: printersPayload?.defaultBikeTagPrinterId === null,
      setAsDefaultReceipt: printersPayload?.defaultReceiptPrinterId === null,
    });
  };

  const saveProductLabelPrintAgentSettings = async () => {
    if (hasProductLabelPrintAgentValidationErrors) {
      error("Fix the highlighted product-label print helper fields before saving.");
      return;
    }

    setSavingProductLabelPrintAgent(true);
    try {
      const payload = await apiPut<ProductLabelPrintAgentSettingsResponse>(
        "/api/settings/product-label-print-agent",
        {
          url: productLabelPrintAgentForm.url.trim() || null,
          sharedSecret: productLabelPrintAgentForm.sharedSecret.trim() || undefined,
          clearSharedSecret: productLabelPrintAgentForm.clearSharedSecret,
        },
      );
      setProductLabelPrintAgentConfig(payload.config);
      setProductLabelPrintAgentForm(toProductLabelPrintAgentFormState(payload.config));
      success(
        payload.config.effectiveSource === "settings"
          ? "Product-label print helper settings updated."
          : payload.config.effectiveSource === "environment"
            ? "Stored helper settings cleared. CorePOS is using environment fallback."
            : "Product-label print helper settings cleared.",
      );
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save product-label print helper settings");
    } finally {
      setSavingProductLabelPrintAgent(false);
    }
  };

  const saveShippingPrintAgentSettings = async () => {
    if (hasShippingPrintAgentValidationErrors) {
      error("Fix the highlighted shipping print helper fields before saving.");
      return;
    }

    setSavingShippingPrintAgent(true);
    try {
      const payload = await apiPut<ShippingPrintAgentSettingsResponse>(
        "/api/settings/shipping-print-agent",
        {
          url: shippingPrintAgentForm.url.trim() || null,
          sharedSecret: shippingPrintAgentForm.sharedSecret.trim() || undefined,
          clearSharedSecret: shippingPrintAgentForm.clearSharedSecret,
        },
      );
      setShippingPrintAgentConfig(payload.config);
      setShippingPrintAgentForm(toShippingPrintAgentFormState(payload.config));
      success(
        payload.config.effectiveSource === "settings"
          ? "Shipping print helper settings updated."
          : payload.config.effectiveSource === "environment"
            ? "Stored shipping helper settings cleared. CorePOS is using environment fallback."
            : "Shipping print helper settings cleared.",
      );
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save shipping print helper settings");
    } finally {
      setSavingShippingPrintAgent(false);
    }
  };

  const saveBikeTagPrintAgentSettings = async () => {
    if (hasBikeTagPrintAgentValidationErrors) {
      error("Fix the highlighted bike-tag print helper fields before saving.");
      return;
    }

    setSavingBikeTagPrintAgent(true);
    try {
      const payload = await apiPut<BikeTagPrintAgentSettingsResponse>(
        "/api/settings/bike-tag-print-agent",
        {
          url: bikeTagPrintAgentForm.url.trim() || null,
          sharedSecret: bikeTagPrintAgentForm.sharedSecret.trim() || undefined,
          clearSharedSecret: bikeTagPrintAgentForm.clearSharedSecret,
        },
      );
      setBikeTagPrintAgentConfig(payload.config);
      setBikeTagPrintAgentForm(toBikeTagPrintAgentFormState(payload.config));
      success(
        payload.config.effectiveSource === "settings"
          ? "Bike-tag print helper settings updated."
          : payload.config.effectiveSource === "environment"
            ? "Stored bike-tag helper settings cleared. CorePOS is using environment fallback."
            : "Bike-tag print helper settings cleared.",
      );
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save bike-tag print helper settings");
    } finally {
      setSavingBikeTagPrintAgent(false);
    }
  };

  const saveReceiptPrintAgentSettings = async () => {
    if (hasReceiptPrintAgentValidationErrors) {
      error("Fix the highlighted receipt print helper fields before saving.");
      return;
    }

    setSavingReceiptPrintAgent(true);
    try {
      const payload = await apiPut<ReceiptPrintAgentSettingsResponse>(
        "/api/settings/receipt-print-agent",
        {
          url: receiptPrintAgentForm.url.trim() || null,
          sharedSecret: receiptPrintAgentForm.sharedSecret.trim() || undefined,
          clearSharedSecret: receiptPrintAgentForm.clearSharedSecret,
        },
      );
      setReceiptPrintAgentConfig(payload.config);
      setReceiptPrintAgentForm(toReceiptPrintAgentFormState(payload.config));
      success(
        payload.config.effectiveSource === "settings"
          ? "Receipt print helper settings updated."
          : payload.config.effectiveSource === "environment"
            ? "Stored receipt helper settings cleared. CorePOS is using environment fallback."
            : "Receipt print helper settings cleared.",
      );
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save receipt print helper settings");
    } finally {
      setSavingReceiptPrintAgent(false);
    }
  };

  const saveReceiptWorkstationDefaults = async () => {
    setSavingReceiptWorkstations(true);
    try {
      const payload = await apiPut<ReceiptPrintWorkstationSettingsResponse>("/api/settings/receipt-workstations", {
        workstations: receiptWorkstations.map((workstation) => ({
          key: workstation.key,
          defaultPrinterId: workstation.defaultPrinterId,
        })),
      });
      setReceiptWorkstations(payload.config.workstations);
      success("Receipt workstation defaults updated.");
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save receipt workstation defaults");
    } finally {
      setSavingReceiptWorkstations(false);
    }
  };

  const handleRetryManagedPrintJob = async (jobId: string) => {
    setRetryingManagedPrintJobId(jobId);
    try {
      const payload = await retryManagedPrintJob(jobId);
      setManagedPrintJobs((current) => current.map((job) => job.id === jobId ? payload.job : job));
      success("Print job queued for retry.");
      await loadManagedPrintJobs();
    } catch (retryError) {
      error(retryError instanceof Error ? retryError.message : "Failed to retry print job");
    } finally {
      setRetryingManagedPrintJobId(null);
    }
  };

  const handleLogoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedLogoFile(file);
  };

  const saveStoreInfo = async () => {
    if (!store) {
      return;
    }
    if (hasValidationErrors) {
      error("Fix the highlighted Store Info fields before saving.");
      return;
    }

    const normalized = normalizeFormBeforeSave(store);
    setSaving(true);
    try {
      const payload = await apiPatch<StoreInfoResponse>("/api/settings/store-info", normalized);
      const normalizedStore = toStoreInfoFormState(payload.store as unknown as Record<string, unknown>);
      invalidateAppConfigCache();
      setStore(normalizedStore);
      setInitialStore(normalizedStore);
      success("Store Info updated.");
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to update Store Info");
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async () => {
    if (!selectedLogoFile || uploadingLogo || removingLogo) {
      return;
    }

    setUploadingLogo(true);
    try {
      const fileDataUrl = await readFileAsDataUrl(selectedLogoFile);
      const payload = await apiPost<StoreInfoResponse>("/api/settings/store-info/logo", {
        fileDataUrl,
      });
      const nextUploadedLogoPath =
        typeof payload.store.uploadedLogoPath === "string" ? payload.store.uploadedLogoPath : "";
      setStore((current) => (current ? { ...current, uploadedLogoPath: nextUploadedLogoPath } : current));
      setInitialStore((current) => (current ? { ...current, uploadedLogoPath: nextUploadedLogoPath } : current));
      invalidateAppConfigCache();
      setSelectedLogoFile(null);
      success(nextUploadedLogoPath ? "Store logo uploaded." : "Store logo updated.");
    } catch (uploadError) {
      error(uploadError instanceof Error ? uploadError.message : "Failed to upload store logo");
    } finally {
      setUploadingLogo(false);
    }
  };

  const removeUploadedLogo = async () => {
    if (!store?.uploadedLogoPath || removingLogo || uploadingLogo) {
      return;
    }

    setRemovingLogo(true);
    try {
      await apiDelete<StoreInfoResponse>("/api/settings/store-info/logo");
      setStore((current) => (current ? { ...current, uploadedLogoPath: "" } : current));
      setInitialStore((current) => (current ? { ...current, uploadedLogoPath: "" } : current));
      invalidateAppConfigCache();
      setSelectedLogoFile(null);
      success("Uploaded store logo removed.");
    } catch (removeError) {
      error(removeError instanceof Error ? removeError.message : "Failed to remove store logo");
    } finally {
      setRemovingLogo(false);
    }
  };

  const saveWorkshopCommercialSettings = async () => {
    if (!workshopCommercial) {
      return;
    }
    if (hasWorkshopCommercialValidationErrors) {
      error("Fix the highlighted workshop commercial settings before saving.");
      return;
    }

    const normalized = {
      commercialSuggestionsEnabled: workshopCommercial.commercialSuggestionsEnabled,
      commercialLongGapDays: Number.parseInt(String(workshopCommercial.commercialLongGapDays), 10),
      commercialRecentServiceCooldownDays: Number.parseInt(
        String(workshopCommercial.commercialRecentServiceCooldownDays),
        10,
      ),
    };

    setSavingWorkshopCommercial(true);
    try {
      const payload = await apiPatch<SettingsResponse>("/api/settings", {
        workshop: normalized,
      });
      const normalizedWorkshopCommercial = toWorkshopCommercialSettings(
        payload.settings.workshop as unknown as Record<string, unknown>,
      );
      setWorkshopCommercial(normalizedWorkshopCommercial);
      setInitialWorkshopCommercial(normalizedWorkshopCommercial);
      success("Workshop commercial settings updated.");
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to update workshop commercial settings");
    } finally {
      setSavingWorkshopCommercial(false);
    }
  };

  const saveShippingProvider = async () => {
    if (!selectedProvider) {
      return;
    }
    if (!selectedProvider.requiresConfiguration) {
      error("This provider is built in and does not have editable stored settings.");
      return;
    }
    if (hasProviderValidationErrors) {
      error("Fix the highlighted shipping provider fields before saving.");
      return;
    }

    const payload = {
      enabled: providerForm.enabled,
      environment: providerForm.environment,
      displayName: providerForm.displayName.trim() || null,
      endpointBaseUrl: selectedProvider.key === "GENERIC_HTTP_ZPL"
        ? providerForm.endpointBaseUrl.trim() || null
        : null,
      apiBaseUrl: selectedProvider.key === "EASYPOST"
        ? providerForm.apiBaseUrl.trim() || null
        : null,
      accountId: selectedProvider.key === "GENERIC_HTTP_ZPL"
        ? providerForm.accountId.trim() || null
        : null,
      carrierAccountId: selectedProvider.key === "EASYPOST"
        ? providerForm.carrierAccountId.trim() || null
        : null,
      defaultServiceCode: selectedProvider.key === "EASYPOST"
        ? providerForm.defaultServiceCode.trim() || null
        : null,
      defaultServiceName: selectedProvider.key === "EASYPOST"
        ? providerForm.defaultServiceName.trim() || null
        : null,
      parcelWeightOz: selectedProvider.key === "EASYPOST"
        ? Number.parseFloat(providerForm.parcelWeightOz)
        : null,
      parcelLengthIn: selectedProvider.key === "EASYPOST"
        ? Number.parseFloat(providerForm.parcelLengthIn)
        : null,
      parcelWidthIn: selectedProvider.key === "EASYPOST"
        ? Number.parseFloat(providerForm.parcelWidthIn)
        : null,
      parcelHeightIn: selectedProvider.key === "EASYPOST"
        ? Number.parseFloat(providerForm.parcelHeightIn)
        : null,
      webhookSecret: selectedProvider.key === "EASYPOST"
        ? providerForm.webhookSecret.trim() || undefined
        : undefined,
      clearWebhookSecret: selectedProvider.key === "EASYPOST"
        ? providerForm.clearWebhookSecret
        : undefined,
      apiKey: providerForm.apiKey.trim() || undefined,
      clearApiKey: providerForm.clearApiKey,
    };

    setSavingProvider(true);
    try {
      await apiPut<ShippingProviderMutationResponse>(
        `/api/settings/shipping-providers/${encodeURIComponent(selectedProvider.key)}`,
        payload,
      );
      await loadShippingProviders(selectedProvider.key);
      success("Shipping provider settings updated.");
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save shipping provider settings");
    } finally {
      setSavingProvider(false);
    }
  };

  const updateDefaultShippingProvider = async (providerKey: string | null) => {
    setSettingDefaultProvider(true);
    try {
      const response = await apiPut<ShippingProviderSettingsListResponse>(
        "/api/settings/shipping-providers/default",
        { providerKey },
      );
      setProviderSettingsPayload(response);
      const nextSelectedProviderKey = providerKey ?? response.defaultProviderKey;
      setSelectedProviderKey(nextSelectedProviderKey);
      setProviderForm(
        toShippingProviderFormState(
          response.providers.find((provider) => provider.key === nextSelectedProviderKey) ?? null,
        ),
      );
      success(
        providerKey
          ? "Default shipping provider updated."
          : "Default shipping provider reset to the built-in mock path.",
      );
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to update default shipping provider");
    } finally {
      setSettingDefaultProvider(false);
    }
  };

  const savePrinter = async () => {
    if (hasPrinterValidationErrors) {
      error("Fix the highlighted printer fields before saving.");
      return;
    }

    const payload = {
      name: printerForm.name.trim(),
      key: printerForm.key.trim().toUpperCase(),
      printerFamily: printerForm.printerFamily,
      printerModelHint: printerForm.printerModelHint,
      supportsShippingLabels: printerForm.supportsShippingLabels,
      supportsProductLabels: printerForm.supportsProductLabels,
      supportsBikeTags: printerForm.supportsBikeTags,
      supportsReceipts: printerForm.supportsReceipts,
      isActive: printerForm.isActive,
      transportMode: printerForm.transportMode,
      windowsPrinterName: printerForm.transportMode === "WINDOWS_PRINTER"
        ? printerForm.windowsPrinterName.trim() || null
        : null,
      rawTcpHost: printerForm.transportMode === "RAW_TCP" ? printerForm.rawTcpHost.trim() : null,
      rawTcpPort: printerForm.transportMode === "RAW_TCP"
        ? Number.parseInt(printerForm.rawTcpPort, 10)
        : null,
      location: printerForm.location.trim() || null,
      notes: printerForm.notes.trim() || null,
      setAsDefaultShippingLabel: printerForm.setAsDefaultShippingLabel,
      setAsDefaultProductLabel: printerForm.setAsDefaultProductLabel,
      setAsDefaultBikeTag: printerForm.setAsDefaultBikeTag,
      setAsDefaultReceipt: printerForm.setAsDefaultReceipt,
    };

    setSavingPrinter(true);
    try {
      const response = selectedPrinterId
        ? await apiPatch<PrinterMutationResponse>(
          `/api/settings/printers/${encodeURIComponent(selectedPrinterId)}`,
          payload,
        )
        : await apiPost<PrinterMutationResponse>("/api/settings/printers", payload);

      await loadPrinters(response.printer.id);
      success(selectedPrinterId ? "Registered printer updated." : "Registered printer created.");
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save registered printer");
    } finally {
      setSavingPrinter(false);
    }
  };

  const updateDefaultShippingLabelPrinter = async (printerId: string | null) => {
    setSettingDefaultPrinter(true);
    try {
      const response = await apiPut<DefaultPrinterResponse>(
        "/api/settings/printers/default-shipping-label",
        { printerId },
      );
      setPrintersPayload((current) => current
        ? {
          ...current,
          defaultShippingLabelPrinterId: response.defaultShippingLabelPrinterId,
          defaultShippingLabelPrinter: response.defaultShippingLabelPrinter,
          defaultProductLabelPrinterId: response.defaultProductLabelPrinterId,
          defaultProductLabelPrinter: response.defaultProductLabelPrinter,
          defaultBikeTagPrinterId: response.defaultBikeTagPrinterId,
          defaultBikeTagPrinter: response.defaultBikeTagPrinter,
          defaultReceiptPrinterId: response.defaultReceiptPrinterId,
          defaultReceiptPrinter: response.defaultReceiptPrinter,
          printers: current.printers.map((printer) => ({
            ...printer,
            isDefaultShippingLabelPrinter: printer.id === response.defaultShippingLabelPrinterId,
            isDefaultProductLabelPrinter: printer.id === response.defaultProductLabelPrinterId,
            isDefaultBikeTagPrinter: printer.id === response.defaultBikeTagPrinterId,
            isDefaultReceiptPrinter: printer.id === response.defaultReceiptPrinterId,
          })),
        }
        : current);
      setPrinterForm((current) => ({
        ...current,
        setAsDefaultShippingLabel: selectedPrinterId === printerId,
        setAsDefaultProductLabel: current.setAsDefaultProductLabel && selectedPrinterId === response.defaultProductLabelPrinterId,
        setAsDefaultBikeTag: current.setAsDefaultBikeTag && selectedPrinterId === response.defaultBikeTagPrinterId,
        setAsDefaultReceipt: current.setAsDefaultReceipt && selectedPrinterId === response.defaultReceiptPrinterId,
      }));
      success(
        printerId
          ? "Default shipping-label printer updated."
          : "Default shipping-label printer cleared.",
      );
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to update default printer");
    } finally {
      setSettingDefaultPrinter(false);
    }
  };

  const updateDefaultProductLabelPrinter = async (printerId: string | null) => {
    setSettingDefaultPrinter(true);
    try {
      const response = await apiPut<DefaultPrinterResponse>(
        "/api/settings/printers/default-product-label",
        { printerId },
      );
      setPrintersPayload((current) => current
        ? {
          ...current,
          defaultShippingLabelPrinterId: response.defaultShippingLabelPrinterId,
          defaultShippingLabelPrinter: response.defaultShippingLabelPrinter,
          defaultProductLabelPrinterId: response.defaultProductLabelPrinterId,
          defaultProductLabelPrinter: response.defaultProductLabelPrinter,
          defaultBikeTagPrinterId: response.defaultBikeTagPrinterId,
          defaultBikeTagPrinter: response.defaultBikeTagPrinter,
          defaultReceiptPrinterId: response.defaultReceiptPrinterId,
          defaultReceiptPrinter: response.defaultReceiptPrinter,
          printers: current.printers.map((printer) => ({
            ...printer,
            isDefaultShippingLabelPrinter: printer.id === response.defaultShippingLabelPrinterId,
            isDefaultProductLabelPrinter: printer.id === response.defaultProductLabelPrinterId,
            isDefaultBikeTagPrinter: printer.id === response.defaultBikeTagPrinterId,
            isDefaultReceiptPrinter: printer.id === response.defaultReceiptPrinterId,
          })),
        }
        : current);
      setPrinterForm((current) => ({
        ...current,
        setAsDefaultShippingLabel: current.setAsDefaultShippingLabel && selectedPrinterId === response.defaultShippingLabelPrinterId,
        setAsDefaultProductLabel: selectedPrinterId === printerId,
        setAsDefaultBikeTag: current.setAsDefaultBikeTag && selectedPrinterId === response.defaultBikeTagPrinterId,
        setAsDefaultReceipt: current.setAsDefaultReceipt && selectedPrinterId === response.defaultReceiptPrinterId,
      }));
      success(
        printerId
          ? "Default product-label printer updated."
          : "Default product-label printer cleared.",
      );
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to update default product-label printer");
    } finally {
      setSettingDefaultPrinter(false);
    }
  };

  const updateDefaultBikeTagPrinter = async (printerId: string | null) => {
    setSettingDefaultPrinter(true);
    try {
      const response = await apiPut<DefaultPrinterResponse>(
        "/api/settings/printers/default-bike-tag",
        { printerId },
      );
      setPrintersPayload((current) => current
        ? {
          ...current,
          defaultShippingLabelPrinterId: response.defaultShippingLabelPrinterId,
          defaultShippingLabelPrinter: response.defaultShippingLabelPrinter,
          defaultProductLabelPrinterId: response.defaultProductLabelPrinterId,
          defaultProductLabelPrinter: response.defaultProductLabelPrinter,
          defaultBikeTagPrinterId: response.defaultBikeTagPrinterId,
          defaultBikeTagPrinter: response.defaultBikeTagPrinter,
          defaultReceiptPrinterId: response.defaultReceiptPrinterId,
          defaultReceiptPrinter: response.defaultReceiptPrinter,
          printers: current.printers.map((printer) => ({
            ...printer,
            isDefaultShippingLabelPrinter: printer.id === response.defaultShippingLabelPrinterId,
            isDefaultProductLabelPrinter: printer.id === response.defaultProductLabelPrinterId,
            isDefaultBikeTagPrinter: printer.id === response.defaultBikeTagPrinterId,
            isDefaultReceiptPrinter: printer.id === response.defaultReceiptPrinterId,
          })),
        }
        : current);
      setPrinterForm((current) => ({
        ...current,
        setAsDefaultShippingLabel: current.setAsDefaultShippingLabel && selectedPrinterId === response.defaultShippingLabelPrinterId,
        setAsDefaultProductLabel: current.setAsDefaultProductLabel && selectedPrinterId === response.defaultProductLabelPrinterId,
        setAsDefaultBikeTag: selectedPrinterId === printerId,
        setAsDefaultReceipt: current.setAsDefaultReceipt && selectedPrinterId === response.defaultReceiptPrinterId,
      }));
      success(
        printerId
          ? "Default bike-tag printer updated."
          : "Default bike-tag printer cleared.",
      );
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to update default bike-tag printer");
    } finally {
      setSettingDefaultPrinter(false);
    }
  };

  const updateDefaultReceiptPrinter = async (printerId: string | null) => {
    setSettingDefaultPrinter(true);
    try {
      const response = await apiPut<DefaultPrinterResponse>(
        "/api/settings/printers/default-receipt",
        { printerId },
      );
      setPrintersPayload((current) => current
        ? {
          ...current,
          defaultShippingLabelPrinterId: response.defaultShippingLabelPrinterId,
          defaultShippingLabelPrinter: response.defaultShippingLabelPrinter,
          defaultProductLabelPrinterId: response.defaultProductLabelPrinterId,
          defaultProductLabelPrinter: response.defaultProductLabelPrinter,
          defaultBikeTagPrinterId: response.defaultBikeTagPrinterId,
          defaultBikeTagPrinter: response.defaultBikeTagPrinter,
          defaultReceiptPrinterId: response.defaultReceiptPrinterId,
          defaultReceiptPrinter: response.defaultReceiptPrinter,
          printers: current.printers.map((printer) => ({
            ...printer,
            isDefaultShippingLabelPrinter: printer.id === response.defaultShippingLabelPrinterId,
            isDefaultProductLabelPrinter: printer.id === response.defaultProductLabelPrinterId,
            isDefaultBikeTagPrinter: printer.id === response.defaultBikeTagPrinterId,
            isDefaultReceiptPrinter: printer.id === response.defaultReceiptPrinterId,
          })),
        }
        : current);
      setPrinterForm((current) => ({
        ...current,
        setAsDefaultShippingLabel: current.setAsDefaultShippingLabel && selectedPrinterId === response.defaultShippingLabelPrinterId,
        setAsDefaultProductLabel: current.setAsDefaultProductLabel && selectedPrinterId === response.defaultProductLabelPrinterId,
        setAsDefaultBikeTag: current.setAsDefaultBikeTag && selectedPrinterId === response.defaultBikeTagPrinterId,
        setAsDefaultReceipt: selectedPrinterId === printerId,
      }));
      success(
        printerId
          ? "Default receipt printer updated."
          : "Default receipt printer cleared.",
      );
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to update default receipt printer");
    } finally {
      setSettingDefaultPrinter(false);
    }
  };

  return (
    <div className="page-shell ui-page">
      <SurfaceCard className="store-info-hero" tone="soft">
        <PageHeader
          eyebrow={
            isPrintersMode
              ? "Settings / Printers"
              : isWorkshopSettingsMode
                ? "Settings / Workshop"
                : isShippingSettingsMode
                  ? "Settings / Shipping"
                  : "Settings / Store Info"
          }
          title={
            isPrintersMode
              ? "Printers"
              : isWorkshopSettingsMode
                ? "Workshop Settings"
                : isShippingSettingsMode
                  ? "Shipping"
                  : "Store Info"
          }
          description={
            isPrintersMode
              ? "Registered printers, workstation defaults, managed queue controls, and helper URLs for receipts, labels, bike tags, and dispatch printing."
              : isWorkshopSettingsMode
                ? "Workshop workflow settings for service prompts, commercial suggestions, and job-facing behavior."
                : isShippingSettingsMode
                  ? "Courier/provider configuration for shipment creation, label buying, and dispatch defaults."
                  : "Central business identity settings for customer communications, opening hours, printed documents, and future storefront surfaces."
          }
          actions={(
            <div className="actions-inline">
              {!isStoreInfoMode ? <Link to="/settings/store-info">Store Info</Link> : null}
              {!isPrintersMode ? <Link to="/settings/printers">Printers</Link> : null}
              {!isWorkshopSettingsMode ? <Link to="/settings/workshop">Workshop</Link> : null}
              {!isShippingSettingsMode ? <Link to="/settings/shipping">Shipping</Link> : null}
            </div>
          )}
        />

        {isPrintersMode ? (
          <>
            <div className="dashboard-summary-grid">
              <div className="metric-card">
                <span className="metric-label">Active Printers</span>
                <strong className="metric-value">
                  {printersPayload ? printersPayload.printers.filter((printer) => printer.isActive).length : "-"}
                </strong>
                <span className="dashboard-metric-detail">Registered live targets available to managed print flows</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Receipt Default</span>
                <strong className="metric-value">{printersPayload?.defaultReceiptPrinter?.name ?? "Not set"}</strong>
                <span className="dashboard-metric-detail">Fallback target when a workstation has no override</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Open Queue Jobs</span>
                <strong className="metric-value">{managedPrintJobs.length}</strong>
                <span className="dashboard-metric-detail">Pending, processing, or failed managed print jobs</span>
              </div>
            </div>

            <div className="restricted-panel info-panel">
              Printers now has the local-printing controls in one place: registered devices, default targets, receipt workstations, print helpers, and the managed queue.
            </div>
          </>
        ) : isWorkshopSettingsMode ? (
          <>
            <div className="dashboard-summary-grid">
              <div className="metric-card">
                <span className="metric-label">Commercial Suggestions</span>
                <strong className="metric-value">
                  {workshopCommercial?.commercialSuggestionsEnabled ? "Enabled" : "Disabled"}
                </strong>
                <span className="dashboard-metric-detail">Staff prompts across workshop intake and bike history</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Long-Gap Window</span>
                <strong className="metric-value">
                  {workshopCommercial ? `${workshopCommercial.commercialLongGapDays} days` : "-"}
                </strong>
                <span className="dashboard-metric-detail">Gap threshold before service prompts become relevant</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Prompt Cooldown</span>
                <strong className="metric-value">
                  {workshopCommercial ? `${workshopCommercial.commercialRecentServiceCooldownDays} days` : "-"}
                </strong>
                <span className="dashboard-metric-detail">Suppresses repeated recommendations after recent service</span>
              </div>
            </div>

            <div className="restricted-panel info-panel">
              Workshop Settings owns the behavior that changes how workshop staff see service prompts and commercial suggestions.
            </div>
          </>
        ) : isShippingSettingsMode ? (
          <>
            <div className="dashboard-summary-grid">
              <div className="metric-card">
                <span className="metric-label">Default Provider</span>
                <strong className="metric-value">{providerSettingsPayload?.defaultProviderKey ?? "Not set"}</strong>
                <span className="dashboard-metric-detail">Provider used first for new shipment labels</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Available Providers</span>
                <strong className="metric-value">
                  {providerSettingsPayload ? providerSettingsPayload.providers.filter((provider) => provider.isAvailable).length : "-"}
                </strong>
                <span className="dashboard-metric-detail">Courier adapters ready for dispatch workflows</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Configured Providers</span>
                <strong className="metric-value">
                  {providerSettingsPayload
                    ? providerSettingsPayload.providers.filter((provider) => Boolean(provider.configuration)).length
                    : "-"}
                </strong>
                <span className="dashboard-metric-detail">External provider records with saved configuration</span>
              </div>
            </div>

            <div className="restricted-panel info-panel">
              Shipping Settings keeps courier/provider choices separate from Store Info and printer hardware setup.
            </div>
          </>
        ) : (
          <>
            <div className="dashboard-summary-grid">
              <div className="metric-card">
                <span className="metric-label">Business Identity</span>
                <strong className="metric-value">{store?.name || "-"}</strong>
                <span className="dashboard-metric-detail">Primary customer-facing store label</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Currency / Time Zone</span>
                <strong className="metric-value">
                  {store ? `${store.defaultCurrency} · ${store.timeZone}` : "-"}
                </strong>
                <span className="dashboard-metric-detail">Used by future configuration-driven workflows</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Receipt Footer</span>
                <strong className="metric-value">{store?.footerText ? "Configured" : "Default"}</strong>
                <span className="dashboard-metric-detail">Synced into current receipt metadata compatibility settings</span>
              </div>
            </div>

            <div className="restricted-panel info-panel">
              Store Info is the app-level source of truth for the shop&apos;s identity, opening hours, and other shared operational settings. Printer-specific controls now live in their own Settings section.
            </div>
          </>
        )}
      </SurfaceCard>

      {isStoreInfoMode ? (
        <>
      <SurfaceCard>
        <SectionHeader
          title="Business Details"
          description="Define how the shop should identify itself across customer-facing and operational surfaces."
          actions={(
            <button
              type="button"
              className="primary"
              onClick={() => void saveStoreInfo()}
              disabled={!store || !isDirty || hasValidationErrors || saving}
            >
              {saving ? "Saving..." : "Save Store Info"}
            </button>
          )}
        />

        {loading ? (
          <EmptyState title="Loading Store Info" description="Fetching the current store profile, contact details, and opening hours." />
        ) : null}

        {!loading && store ? (
          <div className="store-info-sections">
            <section className="store-info-section">
              <h3>Business Details</h3>
              <div className="purchase-form-grid store-info-grid">
                <label>
                  Store name
                  <input
                    value={store.name}
                    onChange={(event) => setField("name", event.target.value)}
                    placeholder="CorePOS Cycles"
                  />
                  {validationErrors.fields.name ? <span className="field-error">{validationErrors.fields.name}</span> : null}
                </label>
                <label>
                  Business / trading name
                  <input
                    value={store.businessName}
                    onChange={(event) => setField("businessName", event.target.value)}
                    placeholder="CorePOS Cycles Ltd"
                  />
                  {validationErrors.fields.businessName ? (
                    <span className="field-error">{validationErrors.fields.businessName}</span>
                  ) : null}
                </label>
                <label>
                  Default currency
                  <input
                    list="store-currencies"
                    value={store.defaultCurrency}
                    onChange={(event) => setField("defaultCurrency", event.target.value)}
                    placeholder="GBP"
                  />
                  {validationErrors.fields.defaultCurrency ? (
                    <span className="field-error">{validationErrors.fields.defaultCurrency}</span>
                  ) : null}
                </label>
                <label>
                  Time zone
                  <input
                    list="store-timezones"
                    value={store.timeZone}
                    onChange={(event) => setField("timeZone", event.target.value)}
                    placeholder="Europe/London"
                  />
                  {validationErrors.fields.timeZone ? (
                    <span className="field-error">{validationErrors.fields.timeZone}</span>
                  ) : null}
                </label>
              </div>
            </section>

            <section className="store-info-section">
              <h3>Contact Details</h3>
              <div className="purchase-form-grid store-info-grid">
                <label>
                  Email address
                  <input
                    value={store.email}
                    onChange={(event) => setField("email", event.target.value)}
                    placeholder="hello@corepos.local"
                  />
                  {validationErrors.fields.email ? <span className="field-error">{validationErrors.fields.email}</span> : null}
                </label>
                <label>
                  Phone number
                  <input
                    value={store.phone}
                    onChange={(event) => setField("phone", event.target.value)}
                    placeholder="01234 567890"
                  />
                </label>
                <label className="store-info-grid-span">
                  Website
                  <input
                    value={store.website}
                    onChange={(event) => setField("website", event.target.value)}
                    placeholder="https://www.corepos.example"
                  />
                  {validationErrors.fields.website ? (
                    <span className="field-error">{validationErrors.fields.website}</span>
                  ) : null}
                </label>
              </div>
            </section>

            <section className="store-info-section">
              <h3>Opening Hours</h3>
              <p className="muted-text">Used as the source of truth for full-day rota imports and dashboard schedule interpretation.</p>
              <div className="store-opening-hours">
                {STORE_WEEKDAYS.map((weekday) => {
                  const day = store.openingHours[weekday.key];
                  return (
                    <div key={weekday.key} className="store-opening-hours-row">
                      <div>
                        <strong>{weekday.label}</strong>
                      </div>
                      <label className="store-opening-hours-toggle">
                        <input
                          type="checkbox"
                          checked={day.isClosed}
                          onChange={(event) => setOpeningHours(weekday.key, { isClosed: event.target.checked })}
                        />
                        Closed
                      </label>
                      <input
                        type="time"
                        value={day.opensAt}
                        disabled={day.isClosed}
                        onChange={(event) => setOpeningHours(weekday.key, { opensAt: event.target.value })}
                      />
                      <span className="muted-text">to</span>
                      <input
                        type="time"
                        value={day.closesAt}
                        disabled={day.isClosed}
                        onChange={(event) => setOpeningHours(weekday.key, { closesAt: event.target.value })}
                      />
                      {validationErrors.openingHours[weekday.key] ? (
                        <span className="field-error store-opening-hours-error">
                          {validationErrors.openingHours[weekday.key]}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="store-info-section">
              <h3>Address</h3>
              <div className="purchase-form-grid store-info-grid">
                <label className="store-info-grid-span">
                  Address line 1
                  <input
                    value={store.addressLine1}
                    onChange={(event) => setField("addressLine1", event.target.value)}
                    placeholder="123 Service Lane"
                  />
                  {validationErrors.fields.addressLine1 ? (
                    <span className="field-error">{validationErrors.fields.addressLine1}</span>
                  ) : null}
                </label>
                <label className="store-info-grid-span">
                  Address line 2
                  <input
                    value={store.addressLine2}
                    onChange={(event) => setField("addressLine2", event.target.value)}
                    placeholder="Industrial Estate / Unit / District"
                  />
                </label>
                <label>
                  City / town
                  <input
                    value={store.city}
                    onChange={(event) => setField("city", event.target.value)}
                    placeholder="Clapham"
                  />
                  {validationErrors.fields.city ? <span className="field-error">{validationErrors.fields.city}</span> : null}
                </label>
                <label>
                  County / region
                  <input
                    value={store.region}
                    onChange={(event) => setField("region", event.target.value)}
                    placeholder="Greater London"
                  />
                </label>
                <label>
                  Postcode
                  <input
                    value={store.postcode}
                    onChange={(event) => setField("postcode", event.target.value)}
                    placeholder="SW4 0HY"
                  />
                  {validationErrors.fields.postcode ? (
                    <span className="field-error">{validationErrors.fields.postcode}</span>
                  ) : null}
                </label>
                <label>
                  Country
                  <input
                    value={store.country}
                    onChange={(event) => setField("country", event.target.value)}
                    placeholder="United Kingdom"
                  />
                  {validationErrors.fields.country ? (
                    <span className="field-error">{validationErrors.fields.country}</span>
                  ) : null}
                </label>
              </div>
            </section>

            <section className="store-info-section">
              <h3>Financial / Legal</h3>
              <div className="purchase-form-grid store-info-grid">
                <label>
                  VAT number
                  <input
                    value={store.vatNumber}
                    onChange={(event) => setField("vatNumber", event.target.value)}
                    placeholder="GB123456789"
                  />
                </label>
                <label>
                  Company number
                  <input
                    value={store.companyNumber}
                    onChange={(event) => setField("companyNumber", event.target.value)}
                    placeholder="01234567"
                  />
                </label>
              </div>
            </section>

            <section className="store-info-section">
              <h3>Branding / Footer</h3>
              <div className="purchase-form-grid store-info-grid">
                <div className="store-logo-panel store-info-grid-span">
                  <div className="store-logo-panel__copy">
                    <strong>Current logo</strong>
                    <span className="muted-text">
                      {isUsingUploadedLogo
                        ? "Uploaded CorePOS-managed logo is active and will be preferred on receipts."
                        : store.logoUrl.trim()
                          ? "No uploaded logo is active, so receipts will fall back to the external logo URL."
                          : "No logo is configured yet."}
                    </span>
                  </div>

                  <div className="store-logo-preview">
                    {preferredLogoUrl ? (
                      <img
                        src={preferredLogoUrl}
                        alt={`${store.name || "Store"} logo preview`}
                      />
                    ) : (
                      <div className="store-logo-preview__empty">No logo configured</div>
                    )}
                  </div>

                  <div className="store-logo-controls">
                    <label>
                      Upload / replace logo
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleLogoFileChange}
                      />
                    </label>

                    <div className="store-logo-buttons">
                      <button
                        type="button"
                        onClick={() => void uploadLogo()}
                        disabled={!selectedLogoFile || uploadingLogo || removingLogo}
                      >
                        {uploadingLogo
                          ? "Uploading..."
                          : isUsingUploadedLogo
                            ? "Replace uploaded logo"
                            : "Upload logo"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeUploadedLogo()}
                        disabled={!store.uploadedLogoPath || removingLogo || uploadingLogo}
                      >
                        {removingLogo ? "Removing..." : "Remove uploaded logo"}
                      </button>
                    </div>
                  </div>

                  <div className="muted-text">
                    {selectedLogoFile
                      ? `Selected file: ${selectedLogoFile.name}`
                      : "PNG, JPG, or WEBP up to 5MB. Uploaded logos are stored locally and preferred on receipts."}
                  </div>
                </div>
                <label className="store-info-grid-span">
                  Logo URL fallback
                  <input
                    value={store.logoUrl}
                    onChange={(event) => setField("logoUrl", event.target.value)}
                    placeholder="https://cdn.example.com/logo.png"
                  />
                  {validationErrors.fields.logoUrl ? (
                    <span className="field-error">{validationErrors.fields.logoUrl}</span>
                  ) : null}
                </label>
                <label className="store-info-grid-span">
                  Receipt / business footer text
                  <textarea
                    rows={4}
                    value={store.footerText}
                    onChange={(event) => setField("footerText", event.target.value)}
                    placeholder="Thank you for your custom."
                  />
                </label>
              </div>
            </section>
          </div>
        ) : null}
      </SurfaceCard>
        </>
      ) : null}

      {isWorkshopSettingsMode ? (
        <>
      <SurfaceCard>
        <SectionHeader
          title="Workshop Commercial Suggestions"
          description="Control the explainable workshop prompts that use bike history, care-plan timing, and current workshop context to surface relevant extra work."
          actions={(
            <button
              type="button"
              className="primary"
              onClick={() => void saveWorkshopCommercialSettings()}
              disabled={
                !workshopCommercial
                || !workshopCommercialDirty
                || hasWorkshopCommercialValidationErrors
                || savingWorkshopCommercial
              }
            >
              {savingWorkshopCommercial ? "Saving..." : "Save Commercial Settings"}
            </button>
          )}
        />

        {loading ? (
          <EmptyState
            title="Loading Workshop Commercial Settings"
            description="Fetching the current rules for service prompts and workshop follow-up suggestions."
          />
        ) : null}

        {!loading && workshopCommercial ? (
          <div className="store-info-sections">
            <section className="store-info-section">
              <h3>Suggestion Controls</h3>
              <div className="purchase-form-grid store-info-grid">
                <label className="store-info-grid-span store-settings-checkbox">
                  <span>Enable workshop commercial suggestions</span>
                  <div className="table-secondary">
                    Show explainable staff-facing prompts on intake, job, and bike-history surfaces.
                  </div>
                  <input
                    type="checkbox"
                    checked={workshopCommercial.commercialSuggestionsEnabled}
                    onChange={(event) =>
                      setWorkshopCommercialField("commercialSuggestionsEnabled", event.target.checked)}
                  />
                </label>
                <label>
                  Long-gap service window (days)
                  <input
                    type="number"
                    min={30}
                    max={1095}
                    step={1}
                    value={workshopCommercial.commercialLongGapDays}
                    onChange={(event) =>
                      setWorkshopCommercialField(
                        "commercialLongGapDays",
                        Number.parseInt(event.target.value || "0", 10),
                      )}
                  />
                  {workshopCommercialValidationErrors.commercialLongGapDays ? (
                    <span className="field-error">
                      {workshopCommercialValidationErrors.commercialLongGapDays}
                    </span>
                  ) : null}
                </label>
                <label>
                  Recent-service cooldown (days)
                  <input
                    type="number"
                    min={0}
                    max={365}
                    step={1}
                    value={workshopCommercial.commercialRecentServiceCooldownDays}
                    onChange={(event) =>
                      setWorkshopCommercialField(
                        "commercialRecentServiceCooldownDays",
                        Number.parseInt(event.target.value || "0", 10),
                      )}
                  />
                  {workshopCommercialValidationErrors.commercialRecentServiceCooldownDays ? (
                    <span className="field-error">
                      {workshopCommercialValidationErrors.commercialRecentServiceCooldownDays}
                    </span>
                  ) : null}
                </label>
              </div>
              <div className="restricted-panel info-panel">
                These controls shape a rules-based suggestion layer. Long-gap prompts handle bikes with meaningful time since the last completed service, while the cooldown prevents staff from raising the same type of recommendation immediately after recent work.
              </div>
            </section>
          </div>
        ) : null}
      </SurfaceCard>
        </>
      ) : null}

      {isShippingSettingsMode ? (
        <>
      <SurfaceCard>
        <SectionHeader
          title="Shipping Providers"
          description="Configure which courier/provider integrations dispatch can use for shipment creation, and choose the default provider for new shipping labels."
          actions={selectedProvider?.requiresConfiguration ? (
            <div className="actions-inline">
              <button
                type="button"
                className="primary"
                onClick={() => void saveShippingProvider()}
                disabled={savingProvider || hasProviderValidationErrors}
              >
                {savingProvider ? "Saving..." : "Save Provider Settings"}
              </button>
            </div>
          ) : null}
        />

        {loading ? (
          <EmptyState
            title="Loading Shipping Providers"
            description="Fetching the configured provider list and current default shipment provider."
          />
        ) : null}

        {!loading ? (
          <div className="shipping-providers-layout">
            <section className="store-info-section shipping-providers-list">
              <h3>Available Providers</h3>
              {providerSettingsPayload?.providers.length ? (
                <div className="shipping-providers-list__items">
                  {providerSettingsPayload.providers.map((provider) => {
                    const isSelected = provider.key === selectedProviderKey;
                    return (
                      <button
                        key={provider.key}
                        type="button"
                        className={`shipping-provider-row${isSelected ? " shipping-provider-row--selected" : ""}`}
                        onClick={() => selectShippingProviderForEditing(provider.key)}
                      >
                        <div className="shipping-provider-row__topline">
                          <strong>{provider.displayName}</strong>
                          <div className="shipping-provider-row__badges">
                            {provider.isDefaultProvider ? (
                              <span className="status-badge status-ready">Default</span>
                            ) : null}
                            <span className={`status-badge ${provider.isAvailable ? "status-info" : "status-warning"}`}>
                              {provider.isAvailable ? "Available" : "Needs config"}
                            </span>
                          </div>
                        </div>
                        <div className="shipping-provider-row__meta">
                          <span>{provider.key}</span>
                          <span>{provider.mode}</span>
                          <span>{provider.implementationState}</span>
                        </div>
                        <div className="shipping-provider-row__meta shipping-provider-row__meta--muted">
                          <span>{provider.defaultServiceName}</span>
                          <span>
                            {provider.configuration
                              ? `${provider.configuration.environment} · ${provider.configuration.enabled ? "Enabled" : "Disabled"}`
                              : "Built-in"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title="No shipping providers found"
                  description="The provider registry did not return any shipment-label providers."
                />
              )}
            </section>

            <section className="store-info-section shipping-providers-editor">
              <h3>{selectedProvider ? selectedProvider.displayName : "Provider Detail"}</h3>
              {!selectedProvider ? (
                <EmptyState
                  title="Select a provider"
                  description="Choose a provider from the list to review its configuration and default-provider status."
                />
              ) : !selectedProvider.requiresConfiguration ? (
                <>
                  <div className="restricted-panel info-panel">
                    <strong>{selectedProvider.displayName}</strong> is the built-in CorePOS mock provider. It stays available for development and fallback use, but it does not store external credentials.
                  </div>
                  <div className="shipping-provider-editor__actions">
                    <button
                      type="button"
                      onClick={() => void updateDefaultShippingProvider(selectedProvider.key)}
                      disabled={settingDefaultProvider || selectedProvider.isDefaultProvider}
                    >
                      {settingDefaultProvider ? "Updating..." : "Set As Default Provider"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="purchase-form-grid store-info-grid">
                    <label className="store-info-grid-span store-settings-checkbox">
                      <span>Enable provider</span>
                      <div className="table-secondary">
                        Disabled providers stay on record but cannot be chosen for shipment creation.
                      </div>
                      <input
                        type="checkbox"
                        checked={providerForm.enabled}
                        onChange={(event) => setProviderField("enabled", event.target.checked)}
                      />
                    </label>
                    <label>
                      Environment
                      <select
                        value={providerForm.environment}
                        onChange={(event) =>
                          setProviderField("environment", event.target.value as ShippingProviderEnvironment)}
                      >
                        <option value="SANDBOX">SANDBOX</option>
                        <option value="LIVE">LIVE</option>
                      </select>
                    </label>
                    <label>
                      Display name override
                      <input
                        value={providerForm.displayName}
                        onChange={(event) => setProviderField("displayName", event.target.value)}
                        placeholder={selectedProvider.displayName}
                      />
                    </label>
                    {selectedProvider.key === "GENERIC_HTTP_ZPL" ? (
                      <>
                        <label className="store-info-grid-span">
                          Endpoint base URL
                          <input
                            value={providerForm.endpointBaseUrl}
                            onChange={(event) => setProviderField("endpointBaseUrl", event.target.value)}
                            placeholder="http://127.0.0.1:4110"
                          />
                          {providerValidationErrors.endpointBaseUrl ? (
                            <span className="field-error">{providerValidationErrors.endpointBaseUrl}</span>
                          ) : null}
                        </label>
                        <label>
                          Account / tenant ID
                          <input
                            value={providerForm.accountId}
                            onChange={(event) => setProviderField("accountId", event.target.value)}
                            placeholder="dispatch-sandbox-1"
                          />
                        </label>
                      </>
                    ) : null}
                    {selectedProviderIsEasyPost ? (
                      <>
                        <label className="store-info-grid-span">
                          API base URL override
                          <input
                            value={providerForm.apiBaseUrl}
                            onChange={(event) => setProviderField("apiBaseUrl", event.target.value)}
                            placeholder="Leave blank for https://api.easypost.com/v2"
                          />
                          {providerValidationErrors.apiBaseUrl ? (
                            <span className="field-error">{providerValidationErrors.apiBaseUrl}</span>
                          ) : (
                            <span className="table-secondary">
                              Leave blank for the official EasyPost API. This is mainly for sandbox stubs and smoke tests.
                            </span>
                          )}
                        </label>
                        <label>
                          Carrier account ID
                          <input
                            value={providerForm.carrierAccountId}
                            onChange={(event) => setProviderField("carrierAccountId", event.target.value)}
                            placeholder="ca_1234567890abcdef"
                          />
                          {providerValidationErrors.carrierAccountId ? (
                            <span className="field-error">{providerValidationErrors.carrierAccountId}</span>
                          ) : null}
                        </label>
                        <label>
                          Default service code
                          <input
                            value={providerForm.defaultServiceCode}
                            onChange={(event) => setProviderField("defaultServiceCode", event.target.value)}
                            placeholder="GroundAdvantage"
                          />
                          {providerValidationErrors.defaultServiceCode ? (
                            <span className="field-error">{providerValidationErrors.defaultServiceCode}</span>
                          ) : null}
                        </label>
                        <label>
                          Default service name
                          <input
                            value={providerForm.defaultServiceName}
                            onChange={(event) => setProviderField("defaultServiceName", event.target.value)}
                            placeholder="Ground Advantage"
                          />
                        </label>
                        <label>
                          Parcel weight (oz)
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={providerForm.parcelWeightOz}
                            onChange={(event) => setProviderField("parcelWeightOz", event.target.value)}
                          />
                          {providerValidationErrors.parcelWeightOz ? (
                            <span className="field-error">{providerValidationErrors.parcelWeightOz}</span>
                          ) : null}
                        </label>
                        <label>
                          Parcel length (in)
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={providerForm.parcelLengthIn}
                            onChange={(event) => setProviderField("parcelLengthIn", event.target.value)}
                          />
                          {providerValidationErrors.parcelLengthIn ? (
                            <span className="field-error">{providerValidationErrors.parcelLengthIn}</span>
                          ) : null}
                        </label>
                        <label>
                          Parcel width (in)
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={providerForm.parcelWidthIn}
                            onChange={(event) => setProviderField("parcelWidthIn", event.target.value)}
                          />
                          {providerValidationErrors.parcelWidthIn ? (
                            <span className="field-error">{providerValidationErrors.parcelWidthIn}</span>
                          ) : null}
                        </label>
                        <label>
                          Parcel height (in)
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={providerForm.parcelHeightIn}
                            onChange={(event) => setProviderField("parcelHeightIn", event.target.value)}
                          />
                          {providerValidationErrors.parcelHeightIn ? (
                            <span className="field-error">{providerValidationErrors.parcelHeightIn}</span>
                          ) : null}
                        </label>
                        <label className="store-info-grid-span">
                          Webhook secret
                          <input
                            type="password"
                            value={providerForm.webhookSecret}
                            onChange={(event) => setProviderField("webhookSecret", event.target.value)}
                            placeholder={selectedProvider.configuration?.webhookSecretHint ?? "Enter a new webhook secret"}
                          />
                          {selectedProvider.configuration?.hasWebhookSecret ? (
                            <span className="table-secondary">
                              Stored secret: {selectedProvider.configuration.webhookSecretHint}
                            </span>
                          ) : (
                            <span className="table-secondary">
                              Optional for automated sync. Without it, staff can still use manual refresh from dispatch.
                            </span>
                          )}
                        </label>
                        <label className="store-info-grid-span store-settings-checkbox">
                          <span>Clear stored webhook secret on save</span>
                          <div className="table-secondary">
                            Leave unticked to preserve the current webhook secret when you are only changing shipment settings.
                          </div>
                          <input
                            type="checkbox"
                            checked={providerForm.clearWebhookSecret}
                            onChange={(event) => setProviderField("clearWebhookSecret", event.target.checked)}
                          />
                        </label>
                        <div className="restricted-panel info-panel store-info-grid-span">
                          EasyPost webhook endpoint: <code>/api/shipping/providers/EASYPOST/webhooks</code>. CorePOS verifies the HMAC signature, records event receipts idempotently, and keeps manual refresh available as a fallback if automated sync is not configured yet.
                        </div>
                      </>
                    ) : null}
                    <label>
                      API key
                      <input
                        type="password"
                        value={providerForm.apiKey}
                        onChange={(event) => setProviderField("apiKey", event.target.value)}
                        placeholder={selectedProvider.configuration?.apiKeyHint ?? "Enter a new API key"}
                      />
                      {providerValidationErrors.apiKey ? (
                        <span className="field-error">{providerValidationErrors.apiKey}</span>
                      ) : selectedProvider.configuration?.hasApiKey ? (
                        <span className="table-secondary">
                          Stored key: {selectedProvider.configuration.apiKeyHint}
                        </span>
                      ) : null}
                    </label>
                    <label className="store-info-grid-span store-settings-checkbox">
                      <span>Clear stored API key on save</span>
                      <div className="table-secondary">
                        Leave unticked to preserve the current key when you are only changing non-secret settings.
                      </div>
                      <input
                        type="checkbox"
                        checked={providerForm.clearApiKey}
                        onChange={(event) => setProviderField("clearApiKey", event.target.checked)}
                      />
                    </label>
                  </div>

                  <div className="shipping-provider-editor__actions">
                    <button
                      type="button"
                      onClick={() => void updateDefaultShippingProvider(selectedProvider.key)}
                      disabled={settingDefaultProvider || !selectedProvider.isAvailable}
                    >
                      {settingDefaultProvider ? "Updating..." : "Set As Default Provider"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateDefaultShippingProvider(null)}
                      disabled={settingDefaultProvider || !selectedProvider.isDefaultProvider}
                    >
                      Reset To Mock Default
                    </button>
                  </div>

                  <div className="restricted-panel info-panel">
                    {selectedProviderIsEasyPost
                      ? "EasyPost is the first real carrier adapter path. CorePOS uses Store Info as the ship-from address, buys the requested EasyPost rate, stores the resulting ZPL locally for safe reprints, and then hands the same label into the registered-printer and Windows Zebra print-agent flow."
                      : "This provider keeps the production-shaped courier adapter contract available for local testing and scaffold integrations. CorePOS still stores the returned ZPL locally so downstream Windows Zebra printing stays stable."}
                  </div>
                </>
              )}
            </section>
          </div>
        ) : null}
      </SurfaceCard>
        </>
      ) : null}

      {isPrintersMode ? (
        <>
      <SurfaceCard>
        <SectionHeader
          title="Registered Printers"
          description="Register Zebra, Dymo, office-document, and thermal receipt printers, then choose the default target each managed print workflow should use."
          actions={(
            <div className="actions-inline">
              <button type="button" className="button-link" onClick={resetPrinterForm}>
                New Printer
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void savePrinter()}
                disabled={savingPrinter || hasPrinterValidationErrors}
              >
                {savingPrinter ? "Saving..." : selectedPrinterId ? "Save Printer" : "Create Printer"}
              </button>
            </div>
          )}
        />

        {loading ? (
          <EmptyState
            title="Loading Registered Printers"
            description="Fetching the registered printer list and current default shipping, product-label, bike-tag, and receipt targets."
          />
        ) : null}

        {!loading ? (
          <div className="dispatch-printers-layout">
            <section className="store-info-section dispatch-printers-list">
              <h3>Registered Printers</h3>
              {printersPayload?.printers.length ? (
                <div className="dispatch-printers-list__items">
                  {printersPayload.printers.map((printer) => {
                    const isSelected = printer.id === selectedPrinterId;
                    return (
                      <button
                        key={printer.id}
                        type="button"
                        className={`dispatch-printer-row${isSelected ? " dispatch-printer-row--selected" : ""}`}
                        onClick={() => selectPrinterForEditing(printer.id)}
                      >
                        <div className="dispatch-printer-row__topline">
                          <strong>{printer.name}</strong>
                          {printer.isDefaultShippingLabelPrinter ? (
                            <span className="status-badge status-ready">Default shipping</span>
                          ) : null}
                          {printer.isDefaultProductLabelPrinter ? (
                            <span className="status-badge status-info">Default product label</span>
                          ) : null}
                          {printer.isDefaultBikeTagPrinter ? (
                            <span className="status-badge status-info">Default bike tag</span>
                          ) : null}
                          {printer.isDefaultReceiptPrinter ? (
                            <span className="status-badge status-info">Default receipt</span>
                          ) : null}
                        </div>
                        <div className="dispatch-printer-row__meta">
                          <span>{printer.key}</span>
                          <span>{printer.printerFamily}</span>
                          <span>{printer.transportMode}</span>
                        </div>
                        <div className="dispatch-printer-row__meta dispatch-printer-row__meta--muted">
                          <span>
                            {[
                              printer.supportsShippingLabels ? "Shipping labels" : null,
                              printer.supportsProductLabels ? "Product labels" : null,
                              printer.supportsBikeTags ? "Bike tags" : null,
                              printer.supportsReceipts ? "Receipts" : null,
                            ].filter(Boolean).join(" · ") || "No workflow capability"}
                          </span>
                          <span>{printer.isActive ? "Active" : "Inactive"}</span>
                        </div>
                        <div className="dispatch-printer-row__meta dispatch-printer-row__meta--muted">
                          <span>{printer.location || "No location set"}</span>
                          <span>
                            {printer.transportMode === "RAW_TCP"
                              ? `${printer.rawTcpHost ?? "-"}:${printer.rawTcpPort ?? "-"}`
                              : printer.transportMode === "WINDOWS_PRINTER"
                                ? printer.windowsPrinterName || "Windows printer target missing"
                                : "Dry-run transport"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title="No registered printers yet"
                  description="Create the first Zebra or Dymo printer so CorePOS can target managed local print paths instead of relying on browser paper handling."
                />
              )}
            </section>

            <section className="store-info-section dispatch-printers-editor">
              <h3>{selectedPrinter ? "Edit Printer" : "Create Printer"}</h3>
              <div className="purchase-form-grid store-info-grid">
                <label>
                  Printer name
                  <input
                    value={printerForm.name}
                    onChange={(event) => setPrinterField("name", event.target.value)}
                    placeholder="Dispatch Zebra GK420d"
                  />
                  {printerValidationErrors.name ? <span className="field-error">{printerValidationErrors.name}</span> : null}
                </label>
                <label>
                  Internal key
                  <input
                    value={printerForm.key}
                    onChange={(event) => setPrinterField("key", event.target.value.toUpperCase())}
                    placeholder="DISPATCH_ZEBRA_GK420D"
                  />
                  {printerValidationErrors.key ? <span className="field-error">{printerValidationErrors.key}</span> : null}
                </label>
                <label>
                  Printer family
                  <select
                    value={printerForm.printerFamily}
                    onChange={(event) => setPrinterFamily(event.target.value as RegisteredPrinterFamily)}
                  >
                    <option value="ZEBRA_LABEL">Zebra shipping label</option>
                    <option value="DYMO_LABEL">Dymo product label</option>
                    <option value="OFFICE_DOCUMENT">Office document / bike tag</option>
                    <option value="THERMAL_RECEIPT">Thermal receipt printer</option>
                  </select>
                </label>
                <label>
                  Model hint
                  <input value={printerForm.printerModelHint} disabled />
                </label>
                <label>
                  Transport mode
                  <select
                    value={printerForm.transportMode}
                    onChange={(event) => {
                      const nextTransportMode = event.target.value as RegisteredPrinterTransportMode;
                      setPrinterForm((current) => ({
                        ...current,
                        transportMode: nextTransportMode,
                        windowsPrinterName: nextTransportMode === "WINDOWS_PRINTER"
                          ? current.windowsPrinterName || current.name
                          : "",
                        rawTcpHost: nextTransportMode === "RAW_TCP" ? current.rawTcpHost : "",
                        rawTcpPort: nextTransportMode === "RAW_TCP" ? current.rawTcpPort || "9100" : "9100",
                      }));
                    }}
                  >
                    {allowedPrinterTransportModes.map((transportMode) => (
                      <option key={transportMode} value={transportMode}>{transportMode}</option>
                    ))}
                  </select>
                  {printerValidationErrors.transportMode ? <span className="field-error">{printerValidationErrors.transportMode}</span> : null}
                </label>
                <label>
                  Location / notes label
                  <input
                    value={printerForm.location}
                    onChange={(event) => setPrinterField("location", event.target.value)}
                    placeholder="Dispatch bench"
                  />
                </label>
                <label>
                  Windows printer name
                  <input
                    value={printerForm.windowsPrinterName}
                    onChange={(event) => setPrinterField("windowsPrinterName", event.target.value)}
                    placeholder={
                      printerForm.printerFamily === "OFFICE_DOCUMENT"
                        ? "Xerox VersaLink C405"
                        : printerForm.printerFamily === "THERMAL_RECEIPT"
                          ? "Till Receipt Printer"
                          : "DYMO LabelWriter 550"
                    }
                    disabled={printerForm.transportMode !== "WINDOWS_PRINTER"}
                  />
                  {printerValidationErrors.windowsPrinterName ? (
                    <span className="field-error">{printerValidationErrors.windowsPrinterName}</span>
                  ) : null}
                </label>
                <label>
                  RAW_TCP host
                  <input
                    value={printerForm.rawTcpHost}
                    onChange={(event) => setPrinterField("rawTcpHost", event.target.value)}
                    placeholder="192.168.1.45"
                    disabled={printerForm.transportMode !== "RAW_TCP"}
                  />
                  {printerValidationErrors.rawTcpHost ? (
                    <span className="field-error">{printerValidationErrors.rawTcpHost}</span>
                  ) : null}
                </label>
                <label>
                  RAW_TCP port
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    step={1}
                    value={printerForm.rawTcpPort}
                    onChange={(event) => setPrinterField("rawTcpPort", event.target.value)}
                    disabled={printerForm.transportMode !== "RAW_TCP"}
                  />
                  {printerValidationErrors.rawTcpPort ? (
                    <span className="field-error">{printerValidationErrors.rawTcpPort}</span>
                  ) : null}
                </label>
                <label className="store-info-grid-span">
                  Notes
                  <textarea
                    rows={3}
                    value={printerForm.notes}
                    onChange={(event) => setPrinterField("notes", event.target.value)}
                    placeholder="Windows dispatch machine beside packing bench."
                  />
                </label>
                <label className="store-info-grid-span store-settings-checkbox">
                  <span>Supports shipping labels</span>
                  <div className="table-secondary">
                    Printer family determines whether this printer is available to the web-order shipment flow.
                  </div>
                  <input
                    type="checkbox"
                    checked={printerFamilyCapabilities.supportsShippingLabels}
                    disabled
                  />
                </label>
                <label className="store-info-grid-span store-settings-checkbox">
                  <span>Supports product labels</span>
                  <div className="table-secondary">
                    Dymo product-label printers are used by the inventory product-label page for direct local printing.
                  </div>
                  <input
                    type="checkbox"
                    checked={printerFamilyCapabilities.supportsProductLabels}
                    disabled
                  />
                </label>
                <label className="store-info-grid-span store-settings-checkbox">
                  <span>Supports bike tags</span>
                  <div className="table-secondary">
                    Office document printers drive one-click bike-tag direct printing through the Windows print helper.
                  </div>
                  <input
                    type="checkbox"
                    checked={printerFamilyCapabilities.supportsBikeTags}
                    disabled
                  />
                </label>
                <label className="store-info-grid-span store-settings-checkbox">
                  <span>Supports receipts</span>
                  <div className="table-secondary">
                    Thermal receipt printers drive the managed ESC/POS receipt flow for POS, workshop, and reprints.
                  </div>
                  <input
                    type="checkbox"
                    checked={printerFamilyCapabilities.supportsReceipts}
                    disabled
                  />
                </label>
                <label className="store-info-grid-span store-settings-checkbox">
                  <span>Printer is active</span>
                  <div className="table-secondary">
                    Inactive printers stay on record for audit/history but cannot be used for live printing.
                  </div>
                  <input
                    type="checkbox"
                    checked={printerForm.isActive}
                    onChange={(event) => setPrinterField("isActive", event.target.checked)}
                  />
                </label>
                {printerFamilyCapabilities.supportsShippingLabels ? (
                  <label className="store-info-grid-span store-settings-checkbox">
                    <span>Make this the default shipping-label printer</span>
                    <div className="table-secondary">
                      Dispatch uses this printer automatically when staff do not choose another registered target.
                    </div>
                    <input
                      type="checkbox"
                      checked={printerForm.setAsDefaultShippingLabel}
                      onChange={(event) =>
                        setPrinterField("setAsDefaultShippingLabel", event.target.checked)}
                    />
                  </label>
                ) : null}
                {printerFamilyCapabilities.supportsProductLabels ? (
                  <label className="store-info-grid-span store-settings-checkbox">
                    <span>Make this the default product-label printer</span>
                    <div className="table-secondary">
                      Direct product-label printing uses this Dymo printer when staff do not choose another target.
                    </div>
                    <input
                      type="checkbox"
                      checked={printerForm.setAsDefaultProductLabel}
                      onChange={(event) =>
                        setPrinterField("setAsDefaultProductLabel", event.target.checked)}
                    />
                  </label>
                ) : null}
                {printerFamilyCapabilities.supportsBikeTags ? (
                  <label className="store-info-grid-span store-settings-checkbox">
                    <span>Make this the default bike-tag printer</span>
                    <div className="table-secondary">
                      One-click bike-tag printing uses this office printer when staff do not choose another target.
                    </div>
                    <input
                      type="checkbox"
                      checked={printerForm.setAsDefaultBikeTag}
                      onChange={(event) =>
                        setPrinterField("setAsDefaultBikeTag", event.target.checked)}
                    />
                  </label>
                ) : null}
                {printerFamilyCapabilities.supportsReceipts ? (
                  <label className="store-info-grid-span store-settings-checkbox">
                    <span>Make this the default receipt printer</span>
                    <div className="table-secondary">
                      Managed thermal receipt printing uses this printer when the current workstation does not override it.
                    </div>
                    <input
                      type="checkbox"
                      checked={printerForm.setAsDefaultReceipt}
                      onChange={(event) =>
                        setPrinterField("setAsDefaultReceipt", event.target.checked)}
                    />
                  </label>
                ) : null}
              </div>

              {selectedPrinter ? (
                <div className="dispatch-printer-editor__actions">
                  {selectedPrinter.supportsShippingLabels ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void updateDefaultShippingLabelPrinter(selectedPrinter.id)}
                        disabled={settingDefaultPrinter || !selectedPrinter.isActive || !selectedPrinter.supportsShippingLabels}
                      >
                        {settingDefaultPrinter ? "Updating..." : "Set As Default Shipping Printer"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void updateDefaultShippingLabelPrinter(null)}
                        disabled={settingDefaultPrinter || printersPayload?.defaultShippingLabelPrinterId !== selectedPrinter.id}
                      >
                        Clear Shipping Default
                      </button>
                    </>
                  ) : null}
                  {selectedPrinter.supportsProductLabels ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void updateDefaultProductLabelPrinter(selectedPrinter.id)}
                        disabled={settingDefaultPrinter || !selectedPrinter.isActive || !selectedPrinter.supportsProductLabels}
                      >
                        {settingDefaultPrinter ? "Updating..." : "Set As Default Product-Label Printer"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void updateDefaultProductLabelPrinter(null)}
                        disabled={settingDefaultPrinter || printersPayload?.defaultProductLabelPrinterId !== selectedPrinter.id}
                      >
                        Clear Product-Label Default
                      </button>
                    </>
                  ) : null}
                  {selectedPrinter.supportsBikeTags ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void updateDefaultBikeTagPrinter(selectedPrinter.id)}
                        disabled={settingDefaultPrinter || !selectedPrinter.isActive || !selectedPrinter.supportsBikeTags}
                      >
                        {settingDefaultPrinter ? "Updating..." : "Set As Default Bike-Tag Printer"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void updateDefaultBikeTagPrinter(null)}
                        disabled={settingDefaultPrinter || printersPayload?.defaultBikeTagPrinterId !== selectedPrinter.id}
                      >
                        Clear Bike-Tag Default
                      </button>
                    </>
                  ) : null}
                  {selectedPrinter.supportsReceipts ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void updateDefaultReceiptPrinter(selectedPrinter.id)}
                        disabled={settingDefaultPrinter || !selectedPrinter.isActive || !selectedPrinter.supportsReceipts}
                      >
                        {settingDefaultPrinter ? "Updating..." : "Set As Default Receipt Printer"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void updateDefaultReceiptPrinter(null)}
                        disabled={settingDefaultPrinter || printersPayload?.defaultReceiptPrinterId !== selectedPrinter.id}
                      >
                        Clear Receipt Default
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}

              <div className="restricted-panel info-panel">
                Registered printers give CorePOS a stable local-print target. Zebra records drive shipment-label printing for dispatch, Dymo records drive direct product-label printing, office document records drive one-click bike-tag printing, and thermal receipt records drive managed ESC/POS receipt printing over the LAN or a controlled Windows host.
              </div>
            </section>
          </div>
        ) : null}
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader
          title="Receipt Print Helper"
          description="Persist the managed receipt helper URL in CorePOS so thermal receipt printing routes through the registered-printer system instead of relying on browser printer memory."
          actions={(
            <div className="actions-inline">
              <button
                type="button"
                className="button-link"
                onClick={() => setReceiptPrintAgentForm(toReceiptPrintAgentFormState(receiptPrintAgentConfig))}
                disabled={savingReceiptPrintAgent}
              >
                Reset
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void saveReceiptPrintAgentSettings()}
                disabled={savingReceiptPrintAgent || hasReceiptPrintAgentValidationErrors}
              >
                {savingReceiptPrintAgent ? "Saving..." : "Save Helper"}
              </button>
            </div>
          )}
        />

        {loading ? (
          <EmptyState
            title="Loading Receipt Print Helper"
            description="Fetching the persisted thermal receipt helper settings and any backend environment fallback."
          />
        ) : (
          <div className="purchase-form-grid store-info-grid">
            <label className="store-info-grid-span">
              Helper base URL
              <input
                value={receiptPrintAgentForm.url}
                onChange={(event) => setReceiptPrintAgentField("url", event.target.value)}
                placeholder="http://192.168.1.45:3214"
              />
              {receiptPrintAgentValidationErrors.url ? (
                <span className="field-error">{receiptPrintAgentValidationErrors.url}</span>
              ) : (
                <span className="table-secondary">
                  CorePOS posts managed receipt jobs to <code>/jobs/receipt</code> on this helper.
                </span>
              )}
            </label>
            <label>
              Shared secret
              <input
                type="password"
                value={receiptPrintAgentForm.sharedSecret}
                onChange={(event) => setReceiptPrintAgentField("sharedSecret", event.target.value)}
                placeholder={receiptPrintAgentConfig?.sharedSecretHint ?? "Enter a new shared secret"}
              />
              {receiptPrintAgentValidationErrors.sharedSecret ? (
                <span className="field-error">{receiptPrintAgentValidationErrors.sharedSecret}</span>
              ) : receiptPrintAgentConfig?.hasSharedSecret ? (
                <span className="table-secondary">
                  Stored secret: {receiptPrintAgentConfig.sharedSecretHint}
                </span>
              ) : (
                <span className="table-secondary">
                  Optional, but recommended when the receipt helper is reachable over the local network.
                </span>
              )}
            </label>
            <label className="store-settings-checkbox">
              <span>Clear stored shared secret on save</span>
              <div className="table-secondary">
                Leave unticked to preserve the current secret when you are only changing the helper URL.
              </div>
              <input
                type="checkbox"
                checked={receiptPrintAgentForm.clearSharedSecret}
                onChange={(event) => setReceiptPrintAgentField("clearSharedSecret", event.target.checked)}
              />
            </label>
            <div className="restricted-panel info-panel store-info-grid-span">
              <strong>Effective helper:</strong>{" "}
              {receiptPrintAgentConfig?.effectiveUrl ? (
                <>
                  <code>{receiptPrintAgentConfig.effectiveUrl}</code> via{" "}
                  {receiptPrintAgentConfig.effectiveSource === "settings"
                    ? "persisted Settings"
                    : "backend environment fallback"}
                  . Health check: <code>{`${receiptPrintAgentConfig.effectiveUrl}/health`}</code>
                </>
              ) : (
                "No receipt print helper is configured yet. Save the helper URL here before relying on managed thermal receipt printing."
              )}
            </div>
            {receiptPrintAgentConfig?.effectiveSource === "environment" && receiptPrintAgentConfig.envFallbackUrl ? (
              <div className="restricted-panel warning-panel store-info-grid-span">
                CorePOS is currently using legacy environment fallback at <code>{receiptPrintAgentConfig.envFallbackUrl}</code>. Save a helper URL here to make receipt printing configuration persistent in CorePOS itself.
              </div>
            ) : null}
          </div>
        )}
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader
          title="Receipt Workstations"
          description="Set the default managed receipt printer for each shop station, then choose which station this browser should behave as."
          actions={(
            <div className="actions-inline">
              <button
                type="button"
                className="primary"
                onClick={() => void saveReceiptWorkstationDefaults()}
                disabled={savingReceiptWorkstations}
              >
                {savingReceiptWorkstations ? "Saving..." : "Save Workstations"}
              </button>
            </div>
          )}
        />

        {loading ? (
          <EmptyState
            title="Loading Receipt Workstations"
            description="Fetching current workstation routing defaults for managed receipt printing."
          />
        ) : (
          <div className="store-info-sections">
            <section className="store-info-section">
              <h3>This Browser</h3>
              <div className="purchase-form-grid store-info-grid">
                <label>
                  Workstation identity
                  <select
                    value={browserReceiptWorkstationKey}
                    onChange={(event) => {
                      const nextKey = event.target.value;
                      setBrowserReceiptWorkstationKey(nextKey);
                      setStoredReceiptWorkstationKey(nextKey || null);
                    }}
                  >
                    <option value="">Use global receipt default</option>
                    {receiptWorkstations.map((workstation) => (
                      <option key={workstation.key} value={workstation.key}>
                        {workstation.label}
                      </option>
                    ))}
                  </select>
                  <span className="table-secondary">
                    Till PC and Workshop 1 can keep a fixed printer default here. Workshop 2 can still override the target on the receipt page.
                  </span>
                </label>
              </div>
            </section>

            <section className="store-info-section">
              <h3>Station Defaults</h3>
              <div className="purchase-form-grid store-info-grid">
                {receiptWorkstations.map((workstation) => (
                  <label key={workstation.key} className="store-info-grid-span">
                    {workstation.label}
                    <select
                      value={workstation.defaultPrinterId ?? ""}
                      onChange={(event) => {
                        const nextPrinterId = event.target.value || null;
                        setReceiptWorkstations((current) =>
                          current.map((entry) =>
                            entry.key === workstation.key
                              ? { ...entry, defaultPrinterId: nextPrinterId }
                              : entry,
                          ));
                      }}
                    >
                      <option value="">Use global receipt default</option>
                      {receiptCapablePrinters.map((printer) => (
                        <option key={printer.id} value={printer.id}>
                          {printer.name}
                        </option>
                      ))}
                    </select>
                    <span className="table-secondary">{workstation.description}</span>
                  </label>
                ))}
              </div>
              <div className="restricted-panel info-panel">
                Managed receipt printing resolves in this order: explicit printer override, workstation default, then the global default receipt printer.
              </div>
            </section>
          </div>
        )}
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader
          title="Managed Print Queue"
          description="Inspect queued, printing, and failed managed print jobs. CorePOS only processes one active job per physical printer at a time."
          actions={(
            <div className="actions-inline">
              <button
                type="button"
                className="button-link"
                onClick={() => void loadManagedPrintJobs()}
                disabled={loadingManagedPrintJobs || Boolean(retryingManagedPrintJobId)}
              >
                {loadingManagedPrintJobs ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          )}
        />

        {loadingManagedPrintJobs && managedPrintJobs.length === 0 ? (
          <EmptyState
            title="Loading Print Queue"
            description="Fetching pending, in-progress, and failed managed print jobs."
          />
        ) : managedPrintJobs.length === 0 ? (
          <EmptyState
            title="No Active Print Jobs"
            description="There are no pending, printing, or failed managed print jobs right now."
          />
        ) : (
          <div className="managed-print-job-list">
            {managedPrintJobs.map((job) => (
              <div key={job.id} className="managed-print-job-card">
                <div className="managed-print-job-card__header">
                  <div>
                    <div className="table-primary">
                      {formatManagedPrintWorkflowLabel(job.workflowType)}
                      {job.documentLabel ? ` · ${job.documentLabel}` : ""}
                    </div>
                    <div className="table-secondary">
                      {job.printerName || job.printerKey || "Managed printer"} · job {job.id.slice(0, 8)}
                    </div>
                  </div>
                  <span className={getManagedPrintJobStatusBadgeClassName(job.status)}>
                    {getManagedPrintJobStatusLabel(job.status)}
                  </span>
                </div>

                <div className="managed-print-job-card__meta">
                  <span>Attempts {job.attemptCount}/{job.maxAttempts}</span>
                  <span>Created {formatManagedPrintTimestamp(job.createdAt)}</span>
                  <span>
                    {job.status === "PENDING"
                      ? `Next attempt ${formatManagedPrintTimestamp(job.nextAttemptAt || job.createdAt)}`
                      : `Started ${formatManagedPrintTimestamp(job.startedAt)}`}
                  </span>
                </div>

                {job.lastError ? (
                  <div className="restricted-panel warning-panel managed-print-job-card__error">
                    <strong>Last error:</strong> {job.lastError}
                  </div>
                ) : null}

                {job.canRetry ? (
                  <div className="managed-print-job-card__actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void handleRetryManagedPrintJob(job.id)}
                      disabled={retryingManagedPrintJobId === job.id}
                    >
                      {retryingManagedPrintJobId === job.id ? "Retrying..." : "Retry job"}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader
          title="Shipping Print Helper (Zebra)"
          description="Persist the Windows Zebra helper URL in CorePOS so shipment-label printing does not rely on backend environment variables."
          actions={(
            <div className="actions-inline">
              <button
                type="button"
                className="button-link"
                onClick={() => setShippingPrintAgentForm(toShippingPrintAgentFormState(shippingPrintAgentConfig))}
                disabled={savingShippingPrintAgent}
              >
                Reset
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void saveShippingPrintAgentSettings()}
                disabled={savingShippingPrintAgent || hasShippingPrintAgentValidationErrors}
              >
                {savingShippingPrintAgent ? "Saving..." : "Save Helper"}
              </button>
            </div>
          )}
        />

        {loading ? (
          <EmptyState
            title="Loading Shipping Print Helper"
            description="Fetching the persisted Zebra helper settings and any backend environment fallback."
          />
        ) : (
          <div className="purchase-form-grid store-info-grid">
            <label className="store-info-grid-span">
              Helper base URL
              <input
                value={shippingPrintAgentForm.url}
                onChange={(event) => setShippingPrintAgentField("url", event.target.value)}
                placeholder="http://192.168.1.45:3211"
              />
              {shippingPrintAgentValidationErrors.url ? (
                <span className="field-error">{shippingPrintAgentValidationErrors.url}</span>
              ) : (
                <span className="table-secondary">
                  CorePOS posts shipment-label print jobs to <code>/jobs/shipment-label</code> on this helper.
                </span>
              )}
            </label>
            <label>
              Shared secret
              <input
                type="password"
                value={shippingPrintAgentForm.sharedSecret}
                onChange={(event) => setShippingPrintAgentField("sharedSecret", event.target.value)}
                placeholder={shippingPrintAgentConfig?.sharedSecretHint ?? "Enter a new shared secret"}
              />
              {shippingPrintAgentValidationErrors.sharedSecret ? (
                <span className="field-error">{shippingPrintAgentValidationErrors.sharedSecret}</span>
              ) : shippingPrintAgentConfig?.hasSharedSecret ? (
                <span className="table-secondary">
                  Stored secret: {shippingPrintAgentConfig.sharedSecretHint}
                </span>
              ) : (
                <span className="table-secondary">
                  Optional, but recommended when the Windows helper is reachable over the local network.
                </span>
              )}
            </label>
            <label className="store-settings-checkbox">
              <span>Clear stored shared secret on save</span>
              <div className="table-secondary">
                Leave unticked to preserve the current secret when you are only changing the helper URL.
              </div>
              <input
                type="checkbox"
                checked={shippingPrintAgentForm.clearSharedSecret}
                onChange={(event) => setShippingPrintAgentField("clearSharedSecret", event.target.checked)}
              />
            </label>
            <div className="restricted-panel info-panel store-info-grid-span">
              <strong>Effective helper:</strong>{" "}
              {shippingPrintAgentConfig?.effectiveUrl ? (
                <>
                  <code>{shippingPrintAgentConfig.effectiveUrl}</code> via{" "}
                  {shippingPrintAgentConfig.effectiveSource === "settings"
                    ? "persisted Settings"
                    : "backend environment fallback"}
                  . Health check: <code>{`${shippingPrintAgentConfig.effectiveUrl}/health`}</code>
                </>
              ) : (
                "No shipping print helper is configured yet. Save the Zebra helper URL in Settings before using Windows-hosted shipment printing."
              )}
            </div>
            {shippingPrintAgentConfig?.effectiveSource === "environment" && shippingPrintAgentConfig.envFallbackUrl ? (
              <div className="restricted-panel warning-panel store-info-grid-span">
                CorePOS is currently using legacy environment fallback at <code>{shippingPrintAgentConfig.envFallbackUrl}</code>. Save a helper URL here to make the Zebra helper configuration persistent in CorePOS itself.
              </div>
            ) : null}
          </div>
        )}
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader
          title="Bike-Tag Print Helper"
          description="Persist the Windows office-printer helper URL in CorePOS so one-click bike-tag printing does not rely on backend environment variables."
          actions={(
            <div className="actions-inline">
              <button
                type="button"
                className="button-link"
                onClick={() => setBikeTagPrintAgentForm(toBikeTagPrintAgentFormState(bikeTagPrintAgentConfig))}
                disabled={savingBikeTagPrintAgent}
              >
                Reset
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void saveBikeTagPrintAgentSettings()}
                disabled={savingBikeTagPrintAgent || hasBikeTagPrintAgentValidationErrors}
              >
                {savingBikeTagPrintAgent ? "Saving..." : "Save Helper"}
              </button>
            </div>
          )}
        />

        {loading ? (
          <EmptyState
            title="Loading Bike-Tag Print Helper"
            description="Fetching the persisted office-printer helper settings and any backend environment fallback."
          />
        ) : (
          <div className="purchase-form-grid store-info-grid">
            <label className="store-info-grid-span">
              Helper base URL
              <input
                value={bikeTagPrintAgentForm.url}
                onChange={(event) => setBikeTagPrintAgentField("url", event.target.value)}
                placeholder="http://192.168.1.45:3213"
              />
              {bikeTagPrintAgentValidationErrors.url ? (
                <span className="field-error">{bikeTagPrintAgentValidationErrors.url}</span>
              ) : (
                <span className="table-secondary">
                  CorePOS posts bike-tag print jobs to <code>/jobs/bike-tag</code> on this helper.
                </span>
              )}
            </label>
            <label>
              Shared secret
              <input
                type="password"
                value={bikeTagPrintAgentForm.sharedSecret}
                onChange={(event) => setBikeTagPrintAgentField("sharedSecret", event.target.value)}
                placeholder={bikeTagPrintAgentConfig?.sharedSecretHint ?? "Enter a new shared secret"}
              />
              {bikeTagPrintAgentValidationErrors.sharedSecret ? (
                <span className="field-error">{bikeTagPrintAgentValidationErrors.sharedSecret}</span>
              ) : bikeTagPrintAgentConfig?.hasSharedSecret ? (
                <span className="table-secondary">
                  Stored secret: {bikeTagPrintAgentConfig.sharedSecretHint}
                </span>
              ) : (
                <span className="table-secondary">
                  Optional, but recommended when the Windows helper is reachable over the local network.
                </span>
              )}
            </label>
            <label className="store-settings-checkbox">
              <span>Clear stored shared secret on save</span>
              <div className="table-secondary">
                Leave unticked to preserve the current secret when you are only changing the helper URL.
              </div>
              <input
                type="checkbox"
                checked={bikeTagPrintAgentForm.clearSharedSecret}
                onChange={(event) => setBikeTagPrintAgentField("clearSharedSecret", event.target.checked)}
              />
            </label>
            <div className="restricted-panel info-panel store-info-grid-span">
              <strong>Effective helper:</strong>{" "}
              {bikeTagPrintAgentConfig?.effectiveUrl ? (
                <>
                  <code>{bikeTagPrintAgentConfig.effectiveUrl}</code> via{" "}
                  {bikeTagPrintAgentConfig.effectiveSource === "settings"
                    ? "persisted Settings"
                    : "backend environment fallback"}
                  . Health check: <code>{`${bikeTagPrintAgentConfig.effectiveUrl}/health`}</code>
                </>
              ) : (
                "No bike-tag print helper is configured yet. Save the Windows office-printer helper URL in Settings before using one-click bike-tag printing."
              )}
            </div>
            {bikeTagPrintAgentConfig?.effectiveSource === "environment" && bikeTagPrintAgentConfig.envFallbackUrl ? (
              <div className="restricted-panel warning-panel store-info-grid-span">
                CorePOS is currently using legacy environment fallback at <code>{bikeTagPrintAgentConfig.envFallbackUrl}</code>. Save a helper URL here to make the bike-tag helper configuration persistent in CorePOS itself.
              </div>
            ) : null}
          </div>
        )}
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader
          title="Product-Label Print Helper"
          description="Persist the Windows Dymo helper URL in CorePOS so product-label direct printing does not rely on backend environment variables."
          actions={(
            <div className="actions-inline">
              <button
                type="button"
                className="button-link"
                onClick={() => setProductLabelPrintAgentForm(toProductLabelPrintAgentFormState(productLabelPrintAgentConfig))}
                disabled={savingProductLabelPrintAgent}
              >
                Reset
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void saveProductLabelPrintAgentSettings()}
                disabled={savingProductLabelPrintAgent || hasProductLabelPrintAgentValidationErrors}
              >
                {savingProductLabelPrintAgent ? "Saving..." : "Save Helper"}
              </button>
            </div>
          )}
        />

        {loading ? (
          <EmptyState
            title="Loading Product-Label Print Helper"
            description="Fetching the persisted Dymo helper settings and any backend environment fallback."
          />
        ) : (
          <div className="purchase-form-grid store-info-grid">
            <label className="store-info-grid-span">
              Helper base URL
              <input
                value={productLabelPrintAgentForm.url}
                onChange={(event) => setProductLabelPrintAgentField("url", event.target.value)}
                placeholder="http://192.168.1.45:3212"
              />
              {productLabelPrintAgentValidationErrors.url ? (
                <span className="field-error">{productLabelPrintAgentValidationErrors.url}</span>
              ) : (
                <span className="table-secondary">
                  CorePOS posts product-label print jobs to <code>/jobs/product-label</code> on this helper.
                </span>
              )}
            </label>
            <label>
              Shared secret
              <input
                type="password"
                value={productLabelPrintAgentForm.sharedSecret}
                onChange={(event) => setProductLabelPrintAgentField("sharedSecret", event.target.value)}
                placeholder={productLabelPrintAgentConfig?.sharedSecretHint ?? "Enter a new shared secret"}
              />
              {productLabelPrintAgentValidationErrors.sharedSecret ? (
                <span className="field-error">{productLabelPrintAgentValidationErrors.sharedSecret}</span>
              ) : productLabelPrintAgentConfig?.hasSharedSecret ? (
                <span className="table-secondary">
                  Stored secret: {productLabelPrintAgentConfig.sharedSecretHint}
                </span>
              ) : (
                <span className="table-secondary">
                  Optional, but recommended when the Windows helper is reachable over the local network.
                </span>
              )}
            </label>
            <label className="store-settings-checkbox">
              <span>Clear stored shared secret on save</span>
              <div className="table-secondary">
                Leave unticked to preserve the current secret when you are only changing the helper URL.
              </div>
              <input
                type="checkbox"
                checked={productLabelPrintAgentForm.clearSharedSecret}
                onChange={(event) => setProductLabelPrintAgentField("clearSharedSecret", event.target.checked)}
              />
            </label>
            <div className="restricted-panel info-panel store-info-grid-span">
              <strong>Effective helper:</strong>{" "}
              {productLabelPrintAgentConfig?.effectiveUrl ? (
                <>
                  <code>{productLabelPrintAgentConfig.effectiveUrl}</code> via{" "}
                  {productLabelPrintAgentConfig.effectiveSource === "settings"
                    ? "persisted Settings"
                    : "backend environment fallback"}
                  . Health check: <code>{`${productLabelPrintAgentConfig.effectiveUrl}/health`}</code>
                </>
              ) : (
                "No product-label print helper is configured yet. Browser print fallback stays available."
              )}
            </div>
            {productLabelPrintAgentConfig?.effectiveSource === "environment" && productLabelPrintAgentConfig.envFallbackUrl ? (
              <div className="restricted-panel warning-panel store-info-grid-span">
                CorePOS is currently using legacy environment fallback at <code>{productLabelPrintAgentConfig.envFallbackUrl}</code>. Save a helper URL here to make the configuration persistent in CorePOS itself.
              </div>
            ) : null}
          </div>
        )}
      </SurfaceCard>
        </>
      ) : null}

      <datalist id="store-timezones">
        {COMMON_TIME_ZONES.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <datalist id="store-currencies">
        {COMMON_CURRENCIES.map((currency) => (
          <option key={currency} value={currency} />
        ))}
      </datalist>
    </div>
  );
};
