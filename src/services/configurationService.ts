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
  };
  operations: {
    lowStockThreshold: number;
  };
};

export type ShopSettingsPatch = Partial<{
  [Section in keyof ShopSettings]: Partial<ShopSettings[Section]>;
}>;

export type StoreInfoSettings = ShopSettings["store"];

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
  "operations.lowStockThreshold": {
    key: "operations.lowStockThreshold",
    defaultValue: 3,
    validate: (value: unknown) =>
      normalizeIntegerSetting(value, "operations.lowStockThreshold", { min: 0, max: 1000 }),
  },
} satisfies Record<string, SettingDefinition<unknown>>;

const getSettingValue = <T>(rowValue: Prisma.JsonValue | undefined, definition: SettingDefinition<T>): T => {
  if (rowValue === undefined) {
    return definition.defaultValue;
  }

  return definition.validate(rowValue);
};

const toSettingsSnapshot = (rows: Array<{ key: string; value: Prisma.JsonValue }>): ShopSettings => {
  const valueByKey = new Map(rows.map((row) => [row.key, row.value]));

  return {
    store: {
      name: getSettingValue(valueByKey.get("store.name"), SETTINGS_DEFINITIONS["store.name"]),
      businessName: getSettingValue(
        valueByKey.get("store.businessName"),
        SETTINGS_DEFINITIONS["store.businessName"],
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
      vatNumber: getSettingValue(valueByKey.get("store.vatNumber"), SETTINGS_DEFINITIONS["store.vatNumber"]),
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
      footerText: getSettingValue(valueByKey.get("store.footerText"), SETTINGS_DEFINITIONS["store.footerText"]),
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
      ),
    },
    operations: {
      lowStockThreshold: getSettingValue(
        valueByKey.get("operations.lowStockThreshold"),
        SETTINGS_DEFINITIONS["operations.lowStockThreshold"],
      ),
    },
  };
};

const flattenPatch = (patch: ShopSettingsPatch) => {
  const updates = new Map<string, unknown>();

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
      updates.set(configKey, definition.validate(value));
    }
  }

  return updates;
};

const buildReceiptAddress = (store: StoreInfoSettings) =>
  [
    store.addressLine1,
    store.addressLine2,
    [store.city, store.region].filter(Boolean).join(", "),
    [store.postcode, store.country].filter(Boolean).join(" "),
  ]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(", ");

const syncLegacyReceiptSettingsTx = async (
  tx: Prisma.TransactionClient,
  store: StoreInfoSettings,
) => {
  await tx.receiptSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      shopName: store.name,
      shopAddress: buildReceiptAddress(store) || "123 Service Lane",
      vatNumber: store.vatNumber || null,
      footerText: store.footerText || "Thank you for your custom.",
    },
    update: {
      shopName: store.name,
      shopAddress: buildReceiptAddress(store) || "123 Service Lane",
      vatNumber: store.vatNumber || null,
      footerText: store.footerText || "Thank you for your custom.",
    },
  });
};

export const listShopSettings = async (db: SettingsClient = prisma): Promise<ShopSettings> => {
  const rows = await db.appConfig.findMany({
    where: {
      key: {
        in: Object.keys(SETTINGS_DEFINITIONS),
      },
    },
    select: {
      key: true,
      value: true,
    },
  });

  return toSettingsSnapshot(rows);
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

  return listShopSettings(db);
};

export const listStoreInfoSettings = async (
  db: SettingsClient = prisma,
): Promise<StoreInfoSettings> => {
  const settings = await listShopSettings(db);
  return settings.store;
};

export const updateStoreInfoSettings = async (
  patch: Partial<StoreInfoSettings>,
  db: SettingsClient = prisma,
): Promise<StoreInfoSettings> => {
  const settings = await updateShopSettings({ store: patch }, db);
  return settings.store;
};
