import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPatch } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { invalidateAppConfigCache } from "../config/appConfig";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SurfaceCard } from "../components/ui/SurfaceCard";

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
  footerText: string;
  openingHours: StoreOpeningHours;
};

type StoreInfoResponse = {
  store: StoreInfo;
};

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

const normalizeFormBeforeSave = (store: StoreInfo): StoreInfo => ({
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
  footerText: typeof store.footerText === "string" ? store.footerText : "",
  openingHours: toOpeningHoursFormState(store.openingHours),
});

export const SystemSettingsPage = () => {
  const { error, success } = useToasts();
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [initialStore, setInitialStore] = useState<StoreInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const payload = await apiGet<StoreInfoResponse>("/api/settings/store-info");
        if (cancelled) {
          return;
        }
        const normalizedStore = toStoreInfoFormState(payload.store as unknown as Record<string, unknown>);
        setStore(normalizedStore);
        setInitialStore(normalizedStore);
      } catch (loadError) {
        if (!cancelled) {
          error(loadError instanceof Error ? loadError.message : "Failed to load Store Info");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
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

  const setField = <K extends keyof StoreInfo>(key: K, value: StoreInfo[K]) => {
    setStore((current) => (current ? { ...current, [key]: value } : current));
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

  return (
    <div className="page-shell ui-page">
      <SurfaceCard className="store-info-hero" tone="soft">
        <PageHeader
          eyebrow="Settings / Store Info"
          title="Store Info"
          description="Central business identity settings for receipts, customer communications, printed documents, and future storefront and profile surfaces."
          actions={(
            <div className="actions-inline">
              <Link to="/settings/receipts">Receipts</Link>
              <Link to="/settings/integrations">Integrations</Link>
            </div>
          )}
        />

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
          Store Info is the app-level source of truth for the shop&apos;s identity, opening hours, and other shared operational settings. Receipt settings stay compatible automatically, and weather plus rota features use the saved store schedule data.
        </div>
      </SurfaceCard>

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
                <label className="store-info-grid-span">
                  Logo URL
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

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Future Reuse</h2>
            <p className="muted-text">This page is intended to support more than just admin editing.</p>
          </div>
        </div>
        <div className="store-info-support">
          <div className="metric-card">
            <span className="metric-label">Receipts & Printed Docs</span>
            <span className="dashboard-metric-detail">Name, address, VAT number, and footer are kept compatible with current receipt generation.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Customer Communications</span>
            <span className="dashboard-metric-detail">Email, phone, website, and store name are ready for reminders, updates, and later outbound templates.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Operational Scheduling</span>
            <span className="dashboard-metric-detail">Opening hours now feed rota imports and dashboard staffing interpretation from the same Store Info source.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Website / Storefront</span>
            <span className="dashboard-metric-detail">Logo, footer, address, and business identity fields can feed the future public-facing profile and site surfaces.</span>
          </div>
        </div>
      </section>

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
