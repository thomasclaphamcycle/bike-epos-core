import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPatch } from "../api/client";
import { useToasts } from "../components/ToastProvider";

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
  latitude: number | null;
  longitude: number | null;
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

const normalizeFormBeforeSave = (store: StoreInfo): StoreInfo => ({
  ...store,
  name: normalizeTextInput(store.name),
  businessName: normalizeTextInput(store.businessName),
  email: store.email.trim().toLowerCase(),
  phone: store.phone.trim(),
  website: store.website.trim(),
  addressLine1: normalizeTextInput(store.addressLine1),
  addressLine2: normalizeTextInput(store.addressLine2),
  city: normalizeTextInput(store.city),
  region: normalizeTextInput(store.region),
  postcode: store.postcode.trim(),
  country: normalizeTextInput(store.country),
  vatNumber: store.vatNumber.trim(),
  companyNumber: store.companyNumber.trim(),
  defaultCurrency: store.defaultCurrency.trim().toUpperCase(),
  timeZone: store.timeZone.trim(),
  logoUrl: store.logoUrl.trim(),
  footerText: store.footerText.trim(),
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
        setStore(payload.store);
        setInitialStore(payload.store);
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
      return {};
    }

    const errors: Partial<Record<keyof StoreInfo, string>> = {};

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
    if (store.latitude !== null && (Number.isNaN(store.latitude) || store.latitude < -90 || store.latitude > 90)) {
      errors.latitude = "Latitude must be between -90 and 90.";
    }
    if (
      store.longitude !== null &&
      (Number.isNaN(store.longitude) || store.longitude < -180 || store.longitude > 180)
    ) {
      errors.longitude = "Longitude must be between -180 and 180.";
    }

    return errors;
  }, [store]);

  const isDirty = useMemo(() => {
    if (!store || !initialStore) {
      return false;
    }

    return JSON.stringify(store) !== JSON.stringify(initialStore);
  }, [initialStore, store]);

  const hasValidationErrors = Object.keys(validationErrors).length > 0;

  const setField = <K extends keyof StoreInfo>(key: K, value: StoreInfo[K]) => {
    setStore((current) => (current ? { ...current, [key]: value } : current));
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
      setStore(payload.store);
      setInitialStore(payload.store);
      success("Store Info updated.");
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to update Store Info");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <section className="card store-info-hero">
        <div className="card-header-row">
          <div>
            <h1>Store Info</h1>
            <p className="muted-text">
              Central business identity settings for receipts, customer communications, printed documents, and future storefront/profile surfaces.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/settings/receipts">Receipts</Link>
            <Link to="/settings/integrations">Integrations</Link>
          </div>
        </div>

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
          Store Info is the app-level source of truth for the shop&apos;s identity. Receipt settings are kept compatible automatically, and dashboard weather still uses the same saved location fields.
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Business Details</h2>
            <p className="muted-text">Define how the shop should identify itself across customer-facing and operational surfaces.</p>
          </div>
          <button
            type="button"
            className="primary"
            onClick={() => void saveStoreInfo()}
            disabled={!store || !isDirty || hasValidationErrors || saving}
          >
            {saving ? "Saving..." : "Save Store Info"}
          </button>
        </div>

        {loading ? <p className="muted-text">Loading Store Info...</p> : null}

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
                  {validationErrors.name ? <span className="field-error">{validationErrors.name}</span> : null}
                </label>
                <label>
                  Business / trading name
                  <input
                    value={store.businessName}
                    onChange={(event) => setField("businessName", event.target.value)}
                    placeholder="CorePOS Cycles Ltd"
                  />
                  {validationErrors.businessName ? (
                    <span className="field-error">{validationErrors.businessName}</span>
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
                  {validationErrors.defaultCurrency ? (
                    <span className="field-error">{validationErrors.defaultCurrency}</span>
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
                  {validationErrors.timeZone ? (
                    <span className="field-error">{validationErrors.timeZone}</span>
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
                  {validationErrors.email ? <span className="field-error">{validationErrors.email}</span> : null}
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
                  {validationErrors.website ? (
                    <span className="field-error">{validationErrors.website}</span>
                  ) : null}
                </label>
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
                  {validationErrors.addressLine1 ? (
                    <span className="field-error">{validationErrors.addressLine1}</span>
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
                  {validationErrors.city ? <span className="field-error">{validationErrors.city}</span> : null}
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
                  {validationErrors.postcode ? (
                    <span className="field-error">{validationErrors.postcode}</span>
                  ) : null}
                </label>
                <label>
                  Country
                  <input
                    value={store.country}
                    onChange={(event) => setField("country", event.target.value)}
                    placeholder="United Kingdom"
                  />
                  {validationErrors.country ? (
                    <span className="field-error">{validationErrors.country}</span>
                  ) : null}
                </label>
                <label>
                  Latitude
                  <input
                    type="number"
                    min="-90"
                    max="90"
                    step="0.000001"
                    value={store.latitude ?? ""}
                    onChange={(event) =>
                      setField("latitude", event.target.value === "" ? null : Number(event.target.value))
                    }
                    placeholder="51.452600"
                  />
                  {validationErrors.latitude ? (
                    <span className="field-error">{validationErrors.latitude}</span>
                  ) : null}
                </label>
                <label>
                  Longitude
                  <input
                    type="number"
                    min="-180"
                    max="180"
                    step="0.000001"
                    value={store.longitude ?? ""}
                    onChange={(event) =>
                      setField("longitude", event.target.value === "" ? null : Number(event.target.value))
                    }
                    placeholder="-0.147700"
                  />
                  {validationErrors.longitude ? (
                    <span className="field-error">{validationErrors.longitude}</span>
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
                  {validationErrors.logoUrl ? (
                    <span className="field-error">{validationErrors.logoUrl}</span>
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
      </section>

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
