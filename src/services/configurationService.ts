import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";

type SettingsClient = Prisma.TransactionClient | typeof prisma;

type SettingDefinition<T> = {
  key: string;
  defaultValue: T;
  validate: (value: unknown) => T;
};

export type ShopSettings = {
  store: {
    name: string;
    email: string;
    phone: string;
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

const SETTINGS_DEFINITIONS = {
  "store.name": {
    key: "store.name",
    defaultValue: "Bike EPOS",
    validate: (value: unknown) => normalizeTextSetting(value, "store.name", { allowEmpty: false, maxLength: 120 }),
  },
  "store.email": {
    key: "store.email",
    defaultValue: "",
    validate: (value: unknown) => normalizeTextSetting(value, "store.email", { maxLength: 160 }),
  },
  "store.phone": {
    key: "store.phone",
    defaultValue: "",
    validate: (value: unknown) => normalizeTextSetting(value, "store.phone", { maxLength: 40 }),
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
      email: getSettingValue(valueByKey.get("store.email"), SETTINGS_DEFINITIONS["store.email"]),
      phone: getSettingValue(valueByKey.get("store.phone"), SETTINGS_DEFINITIONS["store.phone"]),
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

  await db.$transaction(
    Array.from(updates.entries()).map(([key, value]) =>
      db.appConfig.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      }),
    ),
  );

  return listShopSettings(db);
};
