export type ManagementWidgetKey =
  | "sales"
  | "workshop"
  | "inventory"
  | "quickLinks";

export type ManagementWidgetPrefs = {
  visible: Record<ManagementWidgetKey, boolean>;
  order: ManagementWidgetKey[];
};

const STORAGE_PREFIX = "corepos.managementDashboardPrefs";

export const DEFAULT_MANAGEMENT_WIDGET_ORDER: ManagementWidgetKey[] = [
  "sales",
  "workshop",
  "inventory",
  "quickLinks",
];

export const defaultManagementWidgetPrefs = (): ManagementWidgetPrefs => ({
  visible: {
    sales: true,
    workshop: true,
    inventory: true,
    quickLinks: true,
  },
  order: [...DEFAULT_MANAGEMENT_WIDGET_ORDER],
});

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const normalizePrefs = (value: unknown): ManagementWidgetPrefs => {
  const defaults = defaultManagementWidgetPrefs();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const maybeVisible = (value as { visible?: unknown }).visible;
  const maybeOrder = (value as { order?: unknown }).order;

  const visible = { ...defaults.visible };
  if (maybeVisible && typeof maybeVisible === "object") {
    for (const key of DEFAULT_MANAGEMENT_WIDGET_ORDER) {
      const next = (maybeVisible as Record<string, unknown>)[key];
      if (typeof next === "boolean") {
        visible[key] = next;
      }
    }
  }

  const order = Array.isArray(maybeOrder)
    ? maybeOrder.filter((entry): entry is ManagementWidgetKey => DEFAULT_MANAGEMENT_WIDGET_ORDER.includes(entry as ManagementWidgetKey))
    : [];

  const mergedOrder = [
    ...order,
    ...DEFAULT_MANAGEMENT_WIDGET_ORDER.filter((key) => !order.includes(key)),
  ];

  return {
    visible,
    order: mergedOrder,
  };
};

const storageKey = (ownerId: string) => `${STORAGE_PREFIX}.${ownerId}`;

export const loadManagementWidgetPrefs = (ownerId: string): ManagementWidgetPrefs => {
  if (!isBrowser() || !ownerId) {
    return defaultManagementWidgetPrefs();
  }

  try {
    const raw = window.localStorage.getItem(storageKey(ownerId));
    if (!raw) {
      return defaultManagementWidgetPrefs();
    }
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return defaultManagementWidgetPrefs();
  }
};

export const saveManagementWidgetPrefs = (ownerId: string, prefs: ManagementWidgetPrefs) => {
  if (!isBrowser() || !ownerId) {
    return;
  }
  window.localStorage.setItem(storageKey(ownerId), JSON.stringify(normalizePrefs(prefs)));
};

export const resetManagementWidgetPrefs = (ownerId: string) => {
  if (!isBrowser() || !ownerId) {
    return defaultManagementWidgetPrefs();
  }
  const next = defaultManagementWidgetPrefs();
  window.localStorage.setItem(storageKey(ownerId), JSON.stringify(next));
  return next;
};
