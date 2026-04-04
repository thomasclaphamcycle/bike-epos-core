import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import {
  clockTimeToMinutes,
  DEFAULT_STORE_OPENING_HOURS,
  normalizeStoreClockTime,
  STORE_WEEKDAY_KEYS,
  type StoreOpeningHoursSettings,
} from "../utils/storeHours";

type SettingsClient = Prisma.TransactionClient | typeof prisma;

type SettingDefinition<T> = {
  key: string;
  defaultValue: T;
  validate: (value: unknown) => T;
};

export type ShopSettings = {
  store: {
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
    openingHours: StoreOpeningHoursSettings;
    latitude: number | null;
    longitude: number | null;
  };
  pos: {
    defaultTaxRatePercent: number;
    barcodeSearchAutoFocus: boolean;
  };
  workshop: {
    defaultJobDurationMinutes: number;
    defaultDepositPence: number;
    maxBookingsPerDay: number;
    manageTokenTtlDays: number;
    requestTimingMessage: string;
    commercialSuggestionsEnabled: boolean;
    commercialLongGapDays: number;
    commercialRecentServiceCooldownDays: number;
  };
  notifications: {
    workshopAutoSendEnabled: boolean;
    workshopEmailEnabled: boolean;
    workshopSmsEnabled: boolean;
    workshopWhatsappEnabled: boolean;
  };
  operations: {
    lowStockThreshold: number;
    dashboardWeatherEnabled: boolean;
  };
};

export type ShopSettingsPatch = Partial<{
  [Section in keyof ShopSettings]: Partial<ShopSettings[Section]>;
}>;

type PersistedStoreInfoSettings = ShopSettings["store"];
export type StoreInfoSettings = PersistedStoreInfoSettings & {
  preferredLogoUrl: string;
};
export type WorkshopSettings = ShopSettings["workshop"];
export type NotificationSettings = ShopSettings["notifications"];
export type OperationsSettings = ShopSettings["operations"];
export type PublicShopConfig = {
  store: Pick<
    PersistedStoreInfoSettings,
    | "name"
    | "businessName"
    | "email"
    | "phone"
    | "website"
    | "addressLine1"
    | "addressLine2"
    | "city"
    | "region"
    | "postcode"
    | "country"
    | "defaultCurrency"
    | "timeZone"
    | "logoUrl"
    | "uploadedLogoPath"
    | "footerText"
    | "openingHours"
  > & {
    preferredLogoUrl: string;
  };
  pos: ShopSettings["pos"];
  workshop: Pick<
    WorkshopSettings,
    | "defaultJobDurationMinutes"
    | "defaultDepositPence"
    | "maxBookingsPerDay"
    | "requestTimingMessage"
  >;
  operations: OperationsSettings;
};

const DEFAULT_RECEIPT_SHOP_ADDRESS = "123 Service Lane";
const DEFAULT_RECEIPT_FOOTER_TEXT = "Thank you for your custom.";
const DEFAULT_MAX_BOOKINGS_PER_DAY = 8;
const DEFAULT_WORKSHOP_MANAGE_TOKEN_TTL_DAYS = 30;
const DEFAULT_WORKSHOP_REQUEST_TIMING_MESSAGE =
  "Choose a preferred workshop date and drop-off preference. The shop will confirm the final timing if a precise slot is needed.";
const DEFAULT_WORKSHOP_COMMERCIAL_SUGGESTIONS_ENABLED = true;
const DEFAULT_WORKSHOP_COMMERCIAL_LONG_GAP_DAYS = 180;
const DEFAULT_WORKSHOP_COMMERCIAL_RECENT_SERVICE_COOLDOWN_DAYS = 60;
const STORE_LOGO_UPLOAD_PATH_PREFIX = "/uploads/store-logos/";

type LegacySettingsFallbacks = {
  receiptSettings?: {
    shopName: string;
    vatNumber: string | null;
    footerText: string | null;
  } | null;
  bookingSettings?: {
    maxBookingsPerDay: number;
    defaultDepositPence: number;
  } | null;
};

const normalizeTextSetting = (
  value: unknown,
  field: string,
  {
    maxLength = 160,
    allowEmpty = true,
  }: { maxLength?: number; allowEmpty?: boolean } = {},
) => {
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be a string`, "INVALID_SETTINGS");
  }

  const normalized = value.trim();
  if (!allowEmpty && normalized.length === 0) {
    throw new HttpError(400, `${field} cannot be empty`, "INVALID_SETTINGS");
  }
  if (normalized.length > maxLength) {
    throw new HttpError(400, `${field} must be ${maxLength} characters or fewer`, "INVALID_SETTINGS");
  }

  return normalized;
};

const normalizeEmailSetting = (value: unknown, field: string) => {
  const normalized = normalizeTextSetting(value, field, { maxLength: 160 });
  if (normalized.length === 0) {
    return normalized;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalized)) {
    throw new HttpError(400, `${field} must be a valid email address`, "INVALID_SETTINGS");
  }

  return normalized.toLowerCase();
};

const normalizeUrlSetting = (value: unknown, field: string) => {
  const normalized = normalizeTextSetting(value, field, { maxLength: 240 });
  if (normalized.length === 0) {
    return normalized;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new HttpError(400, `${field} must be a valid URL`, "INVALID_SETTINGS");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, `${field} must start with http:// or https://`, "INVALID_SETTINGS");
  }

  return normalized;
};

const normalizeStoreUploadPathSetting = (value: unknown, field: string) => {
  const normalized = normalizeTextSetting(value, field, { maxLength: 240 });
  if (normalized.length === 0) {
    return normalized;
  }

  if (!normalized.startsWith(STORE_LOGO_UPLOAD_PATH_PREFIX)) {
    throw new HttpError(
      400,
      `${field} must point to a managed CorePOS upload`,
      "INVALID_SETTINGS",
    );
  }

  if (normalized.includes("..") || normalized.includes("\\") || /\/$/.test(normalized)) {
    throw new HttpError(
      400,
      `${field} must be a valid managed CorePOS upload path`,
      "INVALID_SETTINGS",
    );
  }

  if (!/\.(png|jpg|jpeg|webp)$/i.test(normalized)) {
    throw new HttpError(
      400,
      `${field} must be a PNG, JPG, or WEBP upload path`,
      "INVALID_SETTINGS",
    );
  }

  return normalized;
};

const normalizePostcodeSetting = (value: unknown, field: string) =>
  normalizeTextSetting(value, field, { allowEmpty: false, maxLength: 32 })
    .replace(/\s+/g, " ")
    .toUpperCase();

const normalizeStoreOpeningHoursSetting = (
  value: unknown,
  field: string,
): StoreOpeningHoursSettings => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${field} must be an object`, "INVALID_SETTINGS");
  }

  const record = value as Record<string, unknown>;
  const normalized = {} as StoreOpeningHoursSettings;

  for (const weekday of STORE_WEEKDAY_KEYS) {
    const rawDay = record[weekday];
    if (!rawDay || typeof rawDay !== "object" || Array.isArray(rawDay)) {
      throw new HttpError(400, `${field}.${weekday} must be an object`, "INVALID_SETTINGS");
    }

    const dayRecord = rawDay as Record<string, unknown>;
    if (typeof dayRecord.isClosed !== "boolean") {
      throw new HttpError(400, `${field}.${weekday}.isClosed must be a boolean`, "INVALID_SETTINGS");
    }

    const opensAtRaw = typeof dayRecord.opensAt === "string" ? dayRecord.opensAt : "";
    const closesAtRaw = typeof dayRecord.closesAt === "string" ? dayRecord.closesAt : "";
    const opensAt = normalizeStoreClockTime(opensAtRaw);
    const closesAt = normalizeStoreClockTime(closesAtRaw);

    if (dayRecord.isClosed) {
      normalized[weekday] = {
        isClosed: true,
        opensAt: "",
        closesAt: "",
      };
      continue;
    }

    if (!opensAt) {
      throw new HttpError(400, `${field}.${weekday}.opensAt must be HH:MM`, "INVALID_SETTINGS");
    }
    if (!closesAt) {
      throw new HttpError(400, `${field}.${weekday}.closesAt must be HH:MM`, "INVALID_SETTINGS");
    }

    const opensAtMinutes = clockTimeToMinutes(opensAt);
    const closesAtMinutes = clockTimeToMinutes(closesAt);
    if (opensAtMinutes === null || closesAtMinutes === null || opensAtMinutes >= closesAtMinutes) {
      throw new HttpError(
        400,
        `${field}.${weekday} must have opensAt earlier than closesAt`,
        "INVALID_SETTINGS",
      );
    }

    normalized[weekday] = {
      isClosed: false,
      opensAt,
      closesAt,
    };
  }

  return normalized;
};

const normalizeCurrencySetting = (value: unknown, field: string) => {
  const normalized = normalizeTextSetting(value, field, {
    allowEmpty: false,
    maxLength: 3,
  }).toUpperCase();

  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new HttpError(400, `${field} must be a 3-letter currency code`, "INVALID_SETTINGS");
  }

  return normalized;
};

const normalizeTimeZoneSetting = (value: unknown, field: string) => {
  const normalized = normalizeTextSetting(value, field, {
    allowEmpty: false,
    maxLength: 120,
  });

  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: normalized }).format(new Date());
  } catch {
    throw new HttpError(400, `${field} must be a valid IANA time zone`, "INVALID_SETTINGS");
  }

  return normalized;
};

const normalizeIntegerSetting = (
  value: unknown,
  field: string,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
) => {
  if (!Number.isInteger(value)) {
    throw new HttpError(400, `${field} must be an integer`, "INVALID_SETTINGS");
  }
  if ((value as number) < min || (value as number) > max) {
    throw new HttpError(
      400,
      `${field} must be between ${min} and ${max}`,
      "INVALID_SETTINGS",
    );
  }

  return value as number;
};

const normalizeBooleanSetting = (value: unknown, field: string) => {
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${field} must be a boolean`, "INVALID_SETTINGS");
  }
  return value;
};

const normalizePercentSetting = (value: unknown, field: string) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new HttpError(400, `${field} must be a number`, "INVALID_SETTINGS");
  }
  if (value < 0 || value > 100) {
    throw new HttpError(400, `${field} must be between 0 and 100`, "INVALID_SETTINGS");
  }
  return Math.round(value * 100) / 100;
};

const normalizeNullableCoordinateSetting = (
  value: unknown,
  field: string,
  { min, max }: { min: number; max: number },
) => {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new HttpError(400, `${field} must be a number or null`, "INVALID_SETTINGS");
  }
  if (value < min || value > max) {
    throw new HttpError(400, `${field} must be between ${min} and ${max}`, "INVALID_SETTINGS");
  }
  return Math.round(value * 1_000_000) / 1_000_000;
};

const SETTINGS_DEFINITIONS = {
  "store.name": {
    key: "store.name",
    defaultValue: "Bike EPOS",
    validate: (value: unknown) => normalizeTextSetting(value, "store.name", { allowEmpty: false, maxLength: 120 }),
  },
  "store.businessName": {
    key: "store.businessName",
    defaultValue: "Bike EPOS",
    validate: (value: unknown) =>
      normalizeTextSetting(value, "store.businessName", { allowEmpty: false, maxLength: 160 }),
  },
  "store.email": {
    key: "store.email",
    defaultValue: "",
    validate: (value: unknown) => normalizeEmailSetting(value, "store.email"),
  },
  "store.phone": {
    key: "store.phone",
    defaultValue: "",
    validate: (value: unknown) => normalizeTextSetting(value, "store.phone", { maxLength: 40 }),
  },
  "store.website": {
    key: "store.website",
    defaultValue: "",
    validate: (value: unknown) => normalizeUrlSetting(value, "store.website"),
  },
  "store.addressLine1": {
    key: "store.addressLine1",
    defaultValue: "",
    validate: (value: unknown) =>
      normalizeTextSetting(value, "store.addressLine1", { allowEmpty: false, maxLength: 160 }),
  },
  "store.addressLine2": {
    key: "store.addressLine2",
    defaultValue: "",
    validate: (value: unknown) => normalizeTextSetting(value, "store.addressLine2", { maxLength: 160 }),
  },
  "store.city": {
    key: "store.city",
    defaultValue: "",
    validate: (value: unknown) =>
      normalizeTextSetting(value, "store.city", { allowEmpty: false, maxLength: 120 }),
  },
  "store.region": {
    key: "store.region",
    defaultValue: "",
    validate: (value: unknown) => normalizeTextSetting(value, "store.region", { maxLength: 120 }),
  },
  "store.postcode": {
    key: "store.postcode",
    defaultValue: "",
    validate: (value: unknown) => normalizePostcodeSetting(value, "store.postcode"),
  },
  "store.country": {
    key: "store.country",
    defaultValue: "United Kingdom",
    validate: (value: unknown) =>
      normalizeTextSetting(value, "store.country", { allowEmpty: false, maxLength: 120 }),
  },
  "store.openingHours": {
    key: "store.openingHours",
    defaultValue: DEFAULT_STORE_OPENING_HOURS,
    validate: (value: unknown) => normalizeStoreOpeningHoursSetting(value, "store.openingHours"),
  },
  "store.vatNumber": {
    key: "store.vatNumber",
    defaultValue: "",
    validate: (value: unknown) => normalizeTextSetting(value, "store.vatNumber", { maxLength: 64 }),
  },
  "store.companyNumber": {
    key: "store.companyNumber",
    defaultValue: "",
    validate: (value: unknown) => normalizeTextSetting(value, "store.companyNumber", { maxLength: 64 }),
  },
  "store.defaultCurrency": {
    key: "store.defaultCurrency",
    defaultValue: "GBP",
    validate: (value: unknown) => normalizeCurrencySetting(value, "store.defaultCurrency"),
  },
  "store.timeZone": {
    key: "store.timeZone",
    defaultValue: "Europe/London",
    validate: (value: unknown) => normalizeTimeZoneSetting(value, "store.timeZone"),
  },
  "store.logoUrl": {
    key: "store.logoUrl",
    defaultValue: "",
    validate: (value: unknown) => normalizeUrlSetting(value, "store.logoUrl"),
  },
  "store.uploadedLogoPath": {
    key: "store.uploadedLogoPath",
    defaultValue: "",
    validate: (value: unknown) => normalizeStoreUploadPathSetting(value, "store.uploadedLogoPath"),
  },
  "store.footerText": {
    key: "store.footerText",
    defaultValue: "Thank you for your custom.",
    validate: (value: unknown) => normalizeTextSetting(value, "store.footerText", { maxLength: 400 }),
  },
  "store.latitude": {
    key: "store.latitude",
    defaultValue: null,
    validate: (value: unknown) => normalizeNullableCoordinateSetting(value, "store.latitude", { min: -90, max: 90 }),
  },
  "store.longitude": {
    key: "store.longitude",
    defaultValue: null,
    validate: (value: unknown) => normalizeNullableCoordinateSetting(value, "store.longitude", { min: -180, max: 180 }),
  },
  "pos.defaultTaxRatePercent": {
    key: "pos.defaultTaxRatePercent",
    defaultValue: 20,
    validate: (value: unknown) => normalizePercentSetting(value, "pos.defaultTaxRatePercent"),
  },
  "pos.barcodeSearchAutoFocus": {
    key: "pos.barcodeSearchAutoFocus",
    defaultValue: true,
    validate: (value: unknown) => normalizeBooleanSetting(value, "pos.barcodeSearchAutoFocus"),
  },
  "workshop.defaultJobDurationMinutes": {
    key: "workshop.defaultJobDurationMinutes",
    defaultValue: 60,
    validate: (value: unknown) =>
      normalizeIntegerSetting(value, "workshop.defaultJobDurationMinutes", { min: 15, max: 480 }),
  },
  "workshop.defaultDepositPence": {
    key: "workshop.defaultDepositPence",
    defaultValue: 1000,
    validate: (value: unknown) =>
      normalizeIntegerSetting(value, "workshop.defaultDepositPence", { min: 0, max: 100000 }),
  },
  "workshop.maxBookingsPerDay": {
    key: "workshop.maxBookingsPerDay",
    defaultValue: DEFAULT_MAX_BOOKINGS_PER_DAY,
    validate: (value: unknown) =>
      normalizeIntegerSetting(value, "workshop.maxBookingsPerDay", { min: 1, max: 200 }),
  },
  "workshop.manageTokenTtlDays": {
    key: "workshop.manageTokenTtlDays",
    defaultValue: DEFAULT_WORKSHOP_MANAGE_TOKEN_TTL_DAYS,
    validate: (value: unknown) =>
      normalizeIntegerSetting(value, "workshop.manageTokenTtlDays", { min: 1, max: 365 }),
  },
  "workshop.requestTimingMessage": {
    key: "workshop.requestTimingMessage",
    defaultValue: DEFAULT_WORKSHOP_REQUEST_TIMING_MESSAGE,
    validate: (value: unknown) =>
      normalizeTextSetting(value, "workshop.requestTimingMessage", { allowEmpty: false, maxLength: 400 }),
  },
  "workshop.commercialSuggestionsEnabled": {
    key: "workshop.commercialSuggestionsEnabled",
    defaultValue: DEFAULT_WORKSHOP_COMMERCIAL_SUGGESTIONS_ENABLED,
    validate: (value: unknown) =>
      normalizeBooleanSetting(value, "workshop.commercialSuggestionsEnabled"),
  },
  "workshop.commercialLongGapDays": {
    key: "workshop.commercialLongGapDays",
    defaultValue: DEFAULT_WORKSHOP_COMMERCIAL_LONG_GAP_DAYS,
    validate: (value: unknown) =>
      normalizeIntegerSetting(value, "workshop.commercialLongGapDays", { min: 30, max: 1095 }),
  },
  "workshop.commercialRecentServiceCooldownDays": {
    key: "workshop.commercialRecentServiceCooldownDays",
    defaultValue: DEFAULT_WORKSHOP_COMMERCIAL_RECENT_SERVICE_COOLDOWN_DAYS,
    validate: (value: unknown) =>
      normalizeIntegerSetting(value, "workshop.commercialRecentServiceCooldownDays", { min: 0, max: 365 }),
  },
  "notifications.workshopAutoSendEnabled": {
    key: "notifications.workshopAutoSendEnabled",
    defaultValue: true,
    validate: (value: unknown) => normalizeBooleanSetting(value, "notifications.workshopAutoSendEnabled"),
  },
  "notifications.workshopEmailEnabled": {
    key: "notifications.workshopEmailEnabled",
    defaultValue: true,
    validate: (value: unknown) => normalizeBooleanSetting(value, "notifications.workshopEmailEnabled"),
  },
  "notifications.workshopSmsEnabled": {
    key: "notifications.workshopSmsEnabled",
    defaultValue: true,
    validate: (value: unknown) => normalizeBooleanSetting(value, "notifications.workshopSmsEnabled"),
  },
  "notifications.workshopWhatsappEnabled": {
    key: "notifications.workshopWhatsappEnabled",
    defaultValue: true,
    validate: (value: unknown) => normalizeBooleanSetting(value, "notifications.workshopWhatsappEnabled"),
  },
  "operations.lowStockThreshold": {
    key: "operations.lowStockThreshold",
    defaultValue: 3,
    validate: (value: unknown) =>
      normalizeIntegerSetting(value, "operations.lowStockThreshold", { min: 0, max: 1000 }),
  },
  "operations.dashboardWeatherEnabled": {
    key: "operations.dashboardWeatherEnabled",
    defaultValue: true,
    validate: (value: unknown) => normalizeBooleanSetting(value, "operations.dashboardWeatherEnabled"),
  },
} satisfies Record<string, SettingDefinition<unknown>>;

const getSettingValue = <T>(
  rowValue: Prisma.JsonValue | undefined,
  definition: SettingDefinition<T>,
  legacyValue?: unknown,
): T => {
  if (rowValue === undefined) {
    if (legacyValue !== undefined) {
      try {
        return definition.validate(legacyValue);
      } catch {
        return definition.defaultValue;
      }
    }

    return definition.defaultValue;
  }

  return definition.validate(rowValue);
};

const toSettingsSnapshot = (
  rows: Array<{ key: string; value: Prisma.JsonValue }>,
  legacyFallbacks: LegacySettingsFallbacks = {},
): ShopSettings => {
  const valueByKey = new Map(rows.map((row) => [row.key, row.value]));

  return {
    store: {
      name: getSettingValue(
        valueByKey.get("store.name"),
        SETTINGS_DEFINITIONS["store.name"],
        legacyFallbacks.receiptSettings?.shopName,
      ),
      businessName: getSettingValue(
        valueByKey.get("store.businessName"),
        SETTINGS_DEFINITIONS["store.businessName"],
        legacyFallbacks.receiptSettings?.shopName,
      ),
      email: getSettingValue(valueByKey.get("store.email"), SETTINGS_DEFINITIONS["store.email"]),
      phone: getSettingValue(valueByKey.get("store.phone"), SETTINGS_DEFINITIONS["store.phone"]),
      website: getSettingValue(valueByKey.get("store.website"), SETTINGS_DEFINITIONS["store.website"]),
      addressLine1: getSettingValue(
        valueByKey.get("store.addressLine1"),
        SETTINGS_DEFINITIONS["store.addressLine1"],
      ),
      addressLine2: getSettingValue(
        valueByKey.get("store.addressLine2"),
        SETTINGS_DEFINITIONS["store.addressLine2"],
      ),
      city: getSettingValue(valueByKey.get("store.city"), SETTINGS_DEFINITIONS["store.city"]),
      region: getSettingValue(valueByKey.get("store.region"), SETTINGS_DEFINITIONS["store.region"]),
      postcode: getSettingValue(valueByKey.get("store.postcode"), SETTINGS_DEFINITIONS["store.postcode"]),
      country: getSettingValue(valueByKey.get("store.country"), SETTINGS_DEFINITIONS["store.country"]),
      openingHours: getSettingValue(
        valueByKey.get("store.openingHours"),
        SETTINGS_DEFINITIONS["store.openingHours"],
      ),
      vatNumber: getSettingValue(
        valueByKey.get("store.vatNumber"),
        SETTINGS_DEFINITIONS["store.vatNumber"],
        legacyFallbacks.receiptSettings?.vatNumber,
      ),
      companyNumber: getSettingValue(
        valueByKey.get("store.companyNumber"),
        SETTINGS_DEFINITIONS["store.companyNumber"],
      ),
      defaultCurrency: getSettingValue(
        valueByKey.get("store.defaultCurrency"),
        SETTINGS_DEFINITIONS["store.defaultCurrency"],
      ),
      timeZone: getSettingValue(valueByKey.get("store.timeZone"), SETTINGS_DEFINITIONS["store.timeZone"]),
      logoUrl: getSettingValue(valueByKey.get("store.logoUrl"), SETTINGS_DEFINITIONS["store.logoUrl"]),
      uploadedLogoPath: getSettingValue(
        valueByKey.get("store.uploadedLogoPath"),
        SETTINGS_DEFINITIONS["store.uploadedLogoPath"],
      ),
      footerText: getSettingValue(
        valueByKey.get("store.footerText"),
        SETTINGS_DEFINITIONS["store.footerText"],
        legacyFallbacks.receiptSettings?.footerText,
      ),
      latitude: getSettingValue(valueByKey.get("store.latitude"), SETTINGS_DEFINITIONS["store.latitude"]),
      longitude: getSettingValue(valueByKey.get("store.longitude"), SETTINGS_DEFINITIONS["store.longitude"]),
    },
    pos: {
      defaultTaxRatePercent: getSettingValue(
        valueByKey.get("pos.defaultTaxRatePercent"),
        SETTINGS_DEFINITIONS["pos.defaultTaxRatePercent"],
      ),
      barcodeSearchAutoFocus: getSettingValue(
        valueByKey.get("pos.barcodeSearchAutoFocus"),
        SETTINGS_DEFINITIONS["pos.barcodeSearchAutoFocus"],
      ),
    },
    workshop: {
      defaultJobDurationMinutes: getSettingValue(
        valueByKey.get("workshop.defaultJobDurationMinutes"),
        SETTINGS_DEFINITIONS["workshop.defaultJobDurationMinutes"],
      ),
      defaultDepositPence: getSettingValue(
        valueByKey.get("workshop.defaultDepositPence"),
        SETTINGS_DEFINITIONS["workshop.defaultDepositPence"],
        legacyFallbacks.bookingSettings?.defaultDepositPence,
      ),
      maxBookingsPerDay: getSettingValue(
        valueByKey.get("workshop.maxBookingsPerDay"),
        SETTINGS_DEFINITIONS["workshop.maxBookingsPerDay"],
        legacyFallbacks.bookingSettings?.maxBookingsPerDay,
      ),
      manageTokenTtlDays: getSettingValue(
        valueByKey.get("workshop.manageTokenTtlDays"),
        SETTINGS_DEFINITIONS["workshop.manageTokenTtlDays"],
      ),
      requestTimingMessage: getSettingValue(
        valueByKey.get("workshop.requestTimingMessage"),
        SETTINGS_DEFINITIONS["workshop.requestTimingMessage"],
      ),
      commercialSuggestionsEnabled: getSettingValue(
        valueByKey.get("workshop.commercialSuggestionsEnabled"),
        SETTINGS_DEFINITIONS["workshop.commercialSuggestionsEnabled"],
      ),
      commercialLongGapDays: getSettingValue(
        valueByKey.get("workshop.commercialLongGapDays"),
        SETTINGS_DEFINITIONS["workshop.commercialLongGapDays"],
      ),
      commercialRecentServiceCooldownDays: getSettingValue(
        valueByKey.get("workshop.commercialRecentServiceCooldownDays"),
        SETTINGS_DEFINITIONS["workshop.commercialRecentServiceCooldownDays"],
      ),
    },
    notifications: {
      workshopAutoSendEnabled: getSettingValue(
        valueByKey.get("notifications.workshopAutoSendEnabled"),
        SETTINGS_DEFINITIONS["notifications.workshopAutoSendEnabled"],
      ),
      workshopEmailEnabled: getSettingValue(
        valueByKey.get("notifications.workshopEmailEnabled"),
        SETTINGS_DEFINITIONS["notifications.workshopEmailEnabled"],
      ),
      workshopSmsEnabled: getSettingValue(
        valueByKey.get("notifications.workshopSmsEnabled"),
        SETTINGS_DEFINITIONS["notifications.workshopSmsEnabled"],
      ),
      workshopWhatsappEnabled: getSettingValue(
        valueByKey.get("notifications.workshopWhatsappEnabled"),
        SETTINGS_DEFINITIONS["notifications.workshopWhatsappEnabled"],
      ),
    },
    operations: {
      lowStockThreshold: getSettingValue(
        valueByKey.get("operations.lowStockThreshold"),
        SETTINGS_DEFINITIONS["operations.lowStockThreshold"],
      ),
      dashboardWeatherEnabled: getSettingValue(
        valueByKey.get("operations.dashboardWeatherEnabled"),
        SETTINGS_DEFINITIONS["operations.dashboardWeatherEnabled"],
      ),
    },
  };
};

const flattenPatch = (patch: ShopSettingsPatch) => {
  const updates = new Map<string, Prisma.InputJsonValue | typeof Prisma.JsonNull>();

  for (const [sectionKey, sectionValue] of Object.entries(patch)) {
    if (!sectionValue || typeof sectionValue !== "object" || Array.isArray(sectionValue)) {
      throw new HttpError(400, `${sectionKey} must be an object`, "INVALID_SETTINGS");
    }

    for (const [fieldKey, value] of Object.entries(sectionValue)) {
      const configKey = `${sectionKey}.${fieldKey}`;
      const definition = SETTINGS_DEFINITIONS[configKey as keyof typeof SETTINGS_DEFINITIONS];
      if (!definition) {
        throw new HttpError(400, `Unknown setting ${configKey}`, "INVALID_SETTINGS");
      }
      const normalizedValue = definition.validate(value);
      updates.set(
        configKey,
        normalizedValue === null
          ? Prisma.JsonNull
          : normalizedValue as Prisma.InputJsonValue,
      );
    }
  }

  return updates;
};

const buildReceiptAddress = (store: PersistedStoreInfoSettings) =>
  [
    store.addressLine1,
    store.addressLine2,
    [store.city, store.region].filter(Boolean).join(", "),
    [store.postcode, store.country].filter(Boolean).join(" "),
  ]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(", ");

export const resolvePreferredStoreLogoUrl = (store: PersistedStoreInfoSettings) =>
  store.uploadedLogoPath || store.logoUrl;

const toResolvedStoreInfoSettings = (store: PersistedStoreInfoSettings): StoreInfoSettings => ({
  ...store,
  preferredLogoUrl: resolvePreferredStoreLogoUrl(store),
});

const startOfUtcDay = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

export const buildLegacyReceiptSettingsFromStore = (store: PersistedStoreInfoSettings) => ({
  shopName: store.name,
  shopAddress: buildReceiptAddress(store) || DEFAULT_RECEIPT_SHOP_ADDRESS,
  vatNumber: store.vatNumber || null,
  footerText: store.footerText || DEFAULT_RECEIPT_FOOTER_TEXT,
});

const syncLegacyReceiptSettingsTx = async (
  tx: Prisma.TransactionClient,
  store: PersistedStoreInfoSettings,
) => {
  const legacySettings = buildLegacyReceiptSettingsFromStore(store);
  await tx.receiptSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      ...legacySettings,
    },
    update: {
      ...legacySettings,
    },
  });
};

const syncLegacyWorkshopBookingSettingsTx = async (
  tx: Prisma.TransactionClient,
  workshop: WorkshopSettings,
) => {
  await tx.bookingSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      minBookableDate: startOfUtcDay(new Date()),
      maxBookingsPerDay: workshop.maxBookingsPerDay,
      defaultDepositPence: workshop.defaultDepositPence,
    },
    update: {
      maxBookingsPerDay: workshop.maxBookingsPerDay,
      defaultDepositPence: workshop.defaultDepositPence,
    },
  });
};

export const listShopSettings = async (db: SettingsClient = prisma): Promise<ShopSettings> => {
  const [rows, receiptSettings, bookingSettings] = await Promise.all([
    db.appConfig.findMany({
      where: {
        key: {
          in: Object.keys(SETTINGS_DEFINITIONS),
        },
      },
      select: {
        key: true,
        value: true,
      },
    }),
    db.receiptSettings.findUnique({
      where: { id: 1 },
      select: {
        shopName: true,
        vatNumber: true,
        footerText: true,
      },
    }),
    db.bookingSettings.findUnique({
      where: { id: 1 },
      select: {
        maxBookingsPerDay: true,
        defaultDepositPence: true,
      },
    }),
  ]);

  return toSettingsSnapshot(rows, {
    receiptSettings,
    bookingSettings,
  });
};

export const listPublicShopConfig = async (
  db: SettingsClient = prisma,
): Promise<PublicShopConfig> => {
  const settings = await listShopSettings(db);
  return {
    store: {
      name: settings.store.name,
      businessName: settings.store.businessName,
      email: settings.store.email,
      phone: settings.store.phone,
      website: settings.store.website,
      addressLine1: settings.store.addressLine1,
      addressLine2: settings.store.addressLine2,
      city: settings.store.city,
      region: settings.store.region,
      postcode: settings.store.postcode,
      country: settings.store.country,
      defaultCurrency: settings.store.defaultCurrency,
      timeZone: settings.store.timeZone,
      logoUrl: settings.store.logoUrl,
      uploadedLogoPath: settings.store.uploadedLogoPath,
      preferredLogoUrl: resolvePreferredStoreLogoUrl(settings.store),
      footerText: settings.store.footerText,
      openingHours: settings.store.openingHours,
    },
    pos: settings.pos,
    workshop: {
      defaultJobDurationMinutes: settings.workshop.defaultJobDurationMinutes,
      defaultDepositPence: settings.workshop.defaultDepositPence,
      maxBookingsPerDay: settings.workshop.maxBookingsPerDay,
      requestTimingMessage: settings.workshop.requestTimingMessage,
    },
    operations: settings.operations,
  };
};

export const getStoreLocaleSettings = async (db: SettingsClient = prisma) => {
  const settings = await listShopSettings(db);
  return {
    currency: settings.store.defaultCurrency,
    timeZone: settings.store.timeZone,
  };
};

export const getWorkshopSettings = async (
  db: SettingsClient = prisma,
): Promise<WorkshopSettings> => {
  const settings = await listShopSettings(db);
  return settings.workshop;
};

export const getNotificationSettings = async (
  db: SettingsClient = prisma,
): Promise<NotificationSettings> => {
  const settings = await listShopSettings(db);
  return settings.notifications;
};

export const getOperationsSettings = async (
  db: SettingsClient = prisma,
): Promise<OperationsSettings> => {
  const settings = await listShopSettings(db);
  return settings.operations;
};

export const updateShopSettings = async (
  patch: ShopSettingsPatch,
  db: SettingsClient = prisma,
): Promise<ShopSettings> => {
  const updates = flattenPatch(patch);
  if (updates.size === 0) {
    throw new HttpError(400, "At least one setting update is required", "INVALID_SETTINGS");
  }

  if (db === prisma) {
    return prisma.$transaction(async (tx) => {
      for (const [key, value] of updates.entries()) {
        await tx.appConfig.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        });
      }

      const settings = await listShopSettings(tx);
      if (patch.store) {
        await syncLegacyReceiptSettingsTx(tx, settings.store);
      }
      if (patch.workshop) {
        await syncLegacyWorkshopBookingSettingsTx(tx, settings.workshop);
      }

      return settings;
    });
  }

  for (const [key, value] of updates.entries()) {
    await db.appConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  const settings = await listShopSettings(db);
  if (patch.store) {
    await syncLegacyReceiptSettingsTx(db, settings.store);
  }
  if (patch.workshop) {
    await syncLegacyWorkshopBookingSettingsTx(db, settings.workshop);
  }

  return settings;
};

export const listStoreInfoSettings = async (
  db: SettingsClient = prisma,
): Promise<StoreInfoSettings> => {
  const settings = await listShopSettings(db);
  return toResolvedStoreInfoSettings(settings.store);
};

export const updateStoreInfoSettings = async (
  patch: Partial<PersistedStoreInfoSettings>,
  db: SettingsClient = prisma,
): Promise<StoreInfoSettings> => {
  const settings = await updateShopSettings({ store: patch }, db);
  return toResolvedStoreInfoSettings(settings.store);
};
