import { type FormEvent, useEffect, useMemo, useState } from "react";
import { apiGet, apiPatch } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { invalidateAppConfigCache } from "../config/appConfig";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import {
  type WorkshopServiceTemplate,
  type WorkshopServiceTemplatesResponse,
} from "../features/workshop/serviceTemplates";

type QuickAddProductSetting = {
  label: string;
  query: string;
  type?: "INVENTORY" | "SERVICE_TEMPLATE";
  refId?: string;
};

type ProductSearchRow = {
  id: string;
  productId?: string;
  name: string;
  sku: string;
  barcode: string | null;
  pricePence: number;
  onHandQty: number;
};

type QuickAddSearchResult =
  | {
      key: string;
      type: "INVENTORY";
      label: string;
      detail: string;
      pricePence: number;
      entry: QuickAddProductSetting;
    }
  | {
      key: string;
      type: "SERVICE_TEMPLATE";
      label: string;
      detail: string;
      pricePence: number;
      entry: QuickAddProductSetting;
    };

type PosSettings = {
  defaultTaxRatePercent: number;
  barcodeSearchAutoFocus: boolean;
  defaultSaleType: "RETAIL" | "QUOTE";
  defaultCustomerType: "WALK_IN" | "PROFILE";
  newBasketMode: "RETAIL_WALK_IN" | "RETAIL_CUSTOMER" | "QUOTE";
  requireCustomerBeforeCheckout: boolean;
  allowZeroPriceLines: boolean;
  allowNegativeDiscounts: boolean;
  managerApprovalForDiscounts: boolean;
  managerApprovalForRefunds: boolean;
  managerApprovalForVoids: boolean;
  autoClearBasketAfterSale: boolean;
  holdBasketTtlHours: number;
  quoteExpiryDays: number;
  requireLineNotes: boolean;
  scanQuantityMode: "INCREMENT_ONE" | "PROMPT_QUANTITY" | "USE_TYPED_QUANTITY";
  quickAddEnabled: boolean;
  quickAddProducts: QuickAddProductSetting[];
  duplicateScanBehavior: "INCREMENT_QUANTITY" | "ADD_SEPARATE_LINE" | "PROMPT";
  enabledTenderMethods: Array<"CASH" | "CARD" | "BANK_TRANSFER" | "VOUCHER" | "STORE_CREDIT">;
  splitPaymentsEnabled: boolean;
  cashRoundingMode: "NONE" | "NEAREST_5P" | "NEAREST_10P";
  promptForReceiptAfterPayment: boolean;
  requirePinForCheckout: boolean;
  requireManagerOverrideForRestrictedActions: boolean;
  tillLockTimeoutSeconds: number;
  compactBasketView: boolean;
  showKeyboardShortcutHints: boolean;
};

type PosSettingsResponse = {
  settings: {
    pos: PosSettings;
  };
};

type NumericPosSettingKey =
  | "defaultTaxRatePercent"
  | "holdBasketTtlHours"
  | "quoteExpiryDays"
  | "tillLockTimeoutSeconds";

const DEFAULT_POS_SETTINGS: PosSettings = {
  defaultTaxRatePercent: 20,
  barcodeSearchAutoFocus: true,
  defaultSaleType: "RETAIL",
  defaultCustomerType: "WALK_IN",
  newBasketMode: "RETAIL_WALK_IN",
  requireCustomerBeforeCheckout: false,
  allowZeroPriceLines: false,
  allowNegativeDiscounts: false,
  managerApprovalForDiscounts: true,
  managerApprovalForRefunds: true,
  managerApprovalForVoids: true,
  autoClearBasketAfterSale: true,
  holdBasketTtlHours: 24,
  quoteExpiryDays: 30,
  requireLineNotes: false,
  scanQuantityMode: "INCREMENT_ONE",
  quickAddEnabled: true,
  quickAddProducts: [
    { label: "Inner Tube", query: "Inner Tube" },
    { label: "Chain Lube", query: "Chain Lube" },
    { label: "Brake Pads", query: "Brake Pads" },
    { label: "Helmet", query: "Helmet" },
    { label: "Floor Pump", query: "Floor Pump" },
    { label: "City Bike", query: "City Bike" },
  ],
  duplicateScanBehavior: "INCREMENT_QUANTITY",
  enabledTenderMethods: ["CARD", "CASH"],
  splitPaymentsEnabled: true,
  cashRoundingMode: "NONE",
  promptForReceiptAfterPayment: true,
  requirePinForCheckout: false,
  requireManagerOverrideForRestrictedActions: true,
  tillLockTimeoutSeconds: 300,
  compactBasketView: false,
  showKeyboardShortcutHints: true,
};

const TENDER_OPTIONS: Array<{ value: PosSettings["enabledTenderMethods"][number]; label: string }> = [
  { value: "CARD", label: "Card" },
  { value: "CASH", label: "Cash" },
  { value: "STORE_CREDIT", label: "Store credit" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "VOUCHER", label: "Voucher" },
];

const withPosDefaults = (settings: Partial<PosSettings> | null | undefined): PosSettings => ({
  ...DEFAULT_POS_SETTINGS,
  ...(settings ?? {}),
  quickAddProducts: Array.isArray(settings?.quickAddProducts)
    ? settings.quickAddProducts
    : DEFAULT_POS_SETTINGS.quickAddProducts,
  enabledTenderMethods:
    settings?.enabledTenderMethods && settings.enabledTenderMethods.length > 0
      ? settings.enabledTenderMethods
      : DEFAULT_POS_SETTINGS.enabledTenderMethods,
});

const formatTenderSummary = (methods: PosSettings["enabledTenderMethods"]) =>
  TENDER_OPTIONS.filter((option) => methods.includes(option.value))
    .map((option) => option.label)
    .join(", ");

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const getTemplateRequiredLineTotal = (template: WorkshopServiceTemplate) =>
  template.lines
    .filter((line) => !line.isOptional)
    .reduce((sum, line) => sum + line.lineTotalPence, 0);

const getQuickAddEntryKey = (entry: QuickAddProductSetting) =>
  `${entry.type ?? "INVENTORY"}:${entry.refId ?? entry.query.trim().toLowerCase()}`;

const normalizeSearchText = (value: string) => value.trim().toLowerCase();

type ToggleSettingProps = {
  checked: boolean;
  description?: string;
  label: string;
  onChange: (checked: boolean) => void;
};

const ToggleSetting = ({ checked, description, label, onChange }: ToggleSettingProps) => (
  <label className="store-info-grid-span store-settings-checkbox pos-settings-toggle">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span>
      <strong>{label}</strong>
      {description ? <span className="pos-settings-field-note">{description}</span> : null}
    </span>
  </label>
);

export const PosSettingsPage = () => {
  const { error, success } = useToasts();
  const [settings, setSettings] = useState<PosSettings>(DEFAULT_POS_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<PosSettings>(DEFAULT_POS_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [quickAddSearchText, setQuickAddSearchText] = useState("");
  const debouncedQuickAddSearchText = useDebouncedValue(quickAddSearchText, 250);
  const [inventoryResults, setInventoryResults] = useState<ProductSearchRow[]>([]);
  const [serviceTemplates, setServiceTemplates] = useState<WorkshopServiceTemplate[]>([]);
  const [quickAddSearchLoading, setQuickAddSearchLoading] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  const isDirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);

  const updateSetting = <K extends keyof PosSettings>(key: K, value: PosSettings[K]) => {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const updateNumberSetting = (key: NumericPosSettingKey, value: string) => {
    const parsed = Number(value);
    setSettings((current) => ({
      ...current,
      [key]: Number.isFinite(parsed) ? parsed : 0,
    }));
  };

  const toggleTenderMethod = (
    method: PosSettings["enabledTenderMethods"][number],
    checked: boolean,
  ) => {
    setSettings((current) => {
      const nextTenderMethods = checked
        ? [...current.enabledTenderMethods.filter((entry) => entry !== method), method]
        : current.enabledTenderMethods.filter((entry) => entry !== method);

      if (nextTenderMethods.length === 0) {
        error("At least one tender method must stay enabled.");
        return current;
      }

      return {
        ...current,
        enabledTenderMethods: nextTenderMethods,
      };
    });
  };

  const updateQuickAddProduct = (
    index: number,
    field: "label" | "query",
    value: string,
  ) => {
    setSettings((current) => ({
      ...current,
      quickAddProducts: current.quickAddProducts.map((entry, entryIndex) => (
        entryIndex === index ? { ...entry, [field]: value } : entry
      )),
    }));
  };

  const addQuickAddProduct = (entry: QuickAddProductSetting) => {
    setSettings((current) => {
      if (current.quickAddProducts.length >= 12) {
        error("Quick-add products are limited to 12 buttons.");
        return current;
      }
      if (current.quickAddProducts.some((existing) => getQuickAddEntryKey(existing) === getQuickAddEntryKey(entry))) {
        error("That quick-add button is already configured.");
        return current;
      }

      return {
        ...current,
        quickAddProducts: [...current.quickAddProducts, entry],
      };
    });
  };

  const removeQuickAddProduct = (index: number) => {
    setSettings((current) => ({
      ...current,
      quickAddProducts: current.quickAddProducts.filter((_, entryIndex) => entryIndex !== index),
    }));
  };

  const loadSettings = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<PosSettingsResponse>("/api/settings");
      const nextSettings = withPosDefaults(payload.settings.pos);
      setSettings(nextSettings);
      setSavedSettings(nextSettings);
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load POS settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadTemplates = async () => {
      setTemplatesLoading(true);
      try {
        const payload = await apiGet<WorkshopServiceTemplatesResponse>("/api/workshop/service-templates");
        if (!cancelled) {
          setServiceTemplates(payload.templates || []);
        }
      } catch (loadError) {
        if (!cancelled) {
          error(loadError instanceof Error ? loadError.message : "Failed to load service templates");
        }
      } finally {
        if (!cancelled) {
          setTemplatesLoading(false);
        }
      }
    };

    void loadTemplates();

    return () => {
      cancelled = true;
    };
  }, [error]);

  useEffect(() => {
    const query = debouncedQuickAddSearchText.trim();
    if (!query) {
      setInventoryResults([]);
      setQuickAddSearchLoading(false);
      return;
    }

    let cancelled = false;

    const searchInventory = async () => {
      setQuickAddSearchLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("q", query);
        params.set("take", "8");
        const payload = await apiGet<{ rows: ProductSearchRow[] }>(`/api/products/search?${params.toString()}`);
        if (!cancelled) {
          setInventoryResults(payload.rows || []);
        }
      } catch (searchError) {
        if (!cancelled) {
          error(searchError instanceof Error ? searchError.message : "Failed to search inventory");
          setInventoryResults([]);
        }
      } finally {
        if (!cancelled) {
          setQuickAddSearchLoading(false);
        }
      }
    };

    void searchInventory();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuickAddSearchText, error]);

  const quickAddSearchResults = useMemo<QuickAddSearchResult[]>(() => {
    const query = normalizeSearchText(debouncedQuickAddSearchText);
    if (!query) {
      return [];
    }

    const inventory: QuickAddSearchResult[] = inventoryResults.map((row) => ({
      key: `inventory-${row.id}`,
      type: "INVENTORY",
      label: row.name,
      detail: [row.sku, row.barcode ? `Barcode ${row.barcode}` : null, `${row.onHandQty} on hand`]
        .filter(Boolean)
        .join(" · "),
      pricePence: row.pricePence,
      entry: {
        label: row.name,
        query: row.sku || row.barcode || row.name,
        type: "INVENTORY",
        refId: row.id,
      },
    }));

    const templates: QuickAddSearchResult[] = serviceTemplates
      .filter((template) => (
        normalizeSearchText([
          template.name,
          template.category ?? "",
          template.description ?? "",
        ].join(" ")).includes(query)
      ))
      .slice(0, 8)
      .map((template) => ({
        key: `template-${template.id}`,
        type: "SERVICE_TEMPLATE",
        label: template.name,
        detail: [
          template.category ?? "Service template",
          `${template.lineCount} line${template.lineCount === 1 ? "" : "s"}`,
          template.pricingMode === "FIXED_PRICE_SERVICE" ? "Fixed price" : "Standard",
        ].join(" · "),
        pricePence: template.targetTotalPricePence ?? getTemplateRequiredLineTotal(template),
        entry: {
          label: template.name,
          query: template.name,
          type: "SERVICE_TEMPLATE",
          refId: template.id,
        },
      }));

    return [...inventory, ...templates];
  }, [debouncedQuickAddSearchText, inventoryResults, serviceTemplates]);

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = await apiPatch<PosSettingsResponse>("/api/settings", {
        pos: settings,
      });
      const nextSettings = withPosDefaults(payload.settings.pos);
      setSettings(nextSettings);
      setSavedSettings(nextSettings);
      invalidateAppConfigCache();
      success("POS settings saved");
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save POS settings");
    } finally {
      setSaving(false);
    }
  };

  const resetChanges = () => {
    setSettings(savedSettings);
  };

  return (
    <div className="page-shell ui-page pos-settings-page">
      <SurfaceCard className="store-info-hero pos-settings-hero" tone="soft">
        <PageHeader
          eyebrow="Settings"
          title="POS Settings"
          description="Control the defaults, checkout policies, basket behaviour, tender options, and till display preferences used by the POS."
          actions={(
            <div className="actions-inline">
              <button type="button" onClick={resetChanges} disabled={!isDirty || saving || loading}>
                Reset
              </button>
              <button
                className="primary"
                type="submit"
                form="pos-settings-form"
                disabled={!isDirty || saving || loading}
              >
                {saving ? "Saving..." : "Save POS settings"}
              </button>
            </div>
          )}
        />

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Fresh baskets</span>
            <strong className="metric-value">
              {settings.newBasketMode === "QUOTE"
                ? "Quote"
                : settings.newBasketMode === "RETAIL_CUSTOMER"
                  ? "Retail customer"
                  : "Retail walk-in"}
            </strong>
            <span className="dashboard-metric-detail">
              Workshop and web sales keep their source when transferred into POS.
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Checkout guard</span>
            <strong className="metric-value">
              {settings.requireCustomerBeforeCheckout ? "Customer required" : "Walk-in allowed"}
            </strong>
            <span className="dashboard-metric-detail">
              Zero price lines are {settings.allowZeroPriceLines ? "allowed" : "blocked"} by default.
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Tender methods</span>
            <strong className="metric-value">{formatTenderSummary(settings.enabledTenderMethods)}</strong>
            <span className="dashboard-metric-detail">
              Split payments are {settings.splitPaymentsEnabled ? "enabled" : "disabled"}.
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Till lock</span>
            <strong className="metric-value">{settings.tillLockTimeoutSeconds}s</strong>
            <span className="dashboard-metric-detail">
              PIN checkout is {settings.requirePinForCheckout ? "required" : "not required"}.
            </span>
          </div>
        </div>
      </SurfaceCard>

      <form id="pos-settings-form" className="store-info-sections" onSubmit={saveSettings}>
        <SurfaceCard className="store-info-section pos-settings-section" as="section">
          <SectionHeader
            eyebrow="Sale defaults"
            title="How new POS work starts"
            description="These defaults apply to fresh till baskets. Workshop and online transfers carry their own source context into POS."
          />
          <div className="purchase-form-grid store-info-grid">
            <label>
              Default sale type
              <select
                value={settings.defaultSaleType}
                onChange={(event) =>
                  updateSetting("defaultSaleType", event.target.value as PosSettings["defaultSaleType"])}
              >
                <option value="RETAIL">Retail sale</option>
                <option value="QUOTE">Quote</option>
              </select>
              <span className="pos-settings-field-note">
                Used when staff start a sale manually from the till.
              </span>
            </label>

            <label>
              Default customer type
              <select
                value={settings.defaultCustomerType}
                onChange={(event) =>
                  updateSetting("defaultCustomerType", event.target.value as PosSettings["defaultCustomerType"])}
              >
                <option value="WALK_IN">Walk-in</option>
                <option value="PROFILE">Customer profile</option>
              </select>
              <span className="pos-settings-field-note">
                The starting customer assumption before staff attach a profile.
              </span>
            </label>

            <label>
              New basket starts as
              <select
                value={settings.newBasketMode}
                onChange={(event) =>
                  updateSetting("newBasketMode", event.target.value as PosSettings["newBasketMode"])}
              >
                <option value="RETAIL_WALK_IN">Retail walk-in</option>
                <option value="RETAIL_CUSTOMER">Retail customer</option>
                <option value="QUOTE">Quote</option>
              </select>
              <span className="pos-settings-field-note">
                This gives the till an explicit starting mode rather than a vague "New Sale".
              </span>
            </label>

            <label>
              Default VAT rate %
              <input
                min="0"
                max="100"
                step="0.01"
                type="number"
                value={settings.defaultTaxRatePercent}
                onChange={(event) => updateNumberSetting("defaultTaxRatePercent", event.target.value)}
              />
            </label>
          </div>
        </SurfaceCard>

        <SurfaceCard className="store-info-section pos-settings-section" as="section">
          <SectionHeader
            eyebrow="Checkout behaviour"
            title="Rules before money changes hands"
            description="These controls define what the till should allow and which actions should need manager approval."
          />
          <div className="purchase-form-grid store-info-grid">
            <ToggleSetting
              checked={settings.requireCustomerBeforeCheckout}
              label="Require a customer before checkout"
              description="Useful for account-led workflows. Leave off if walk-in sales are normal."
              onChange={(checked) => updateSetting("requireCustomerBeforeCheckout", checked)}
            />
            <ToggleSetting
              checked={settings.allowZeroPriceLines}
              label="Allow zero-price lines"
              description="Permits warranty, goodwill, or bundled items to be added at no charge."
              onChange={(checked) => updateSetting("allowZeroPriceLines", checked)}
            />
            <ToggleSetting
              checked={settings.allowNegativeDiscounts}
              label="Allow negative discounts"
              description="Keeps discount inputs flexible, but is normally safer off."
              onChange={(checked) => updateSetting("allowNegativeDiscounts", checked)}
            />
            <ToggleSetting
              checked={settings.managerApprovalForDiscounts}
              label="Manager approval for discounts"
              onChange={(checked) => updateSetting("managerApprovalForDiscounts", checked)}
            />
            <ToggleSetting
              checked={settings.managerApprovalForRefunds}
              label="Manager approval for refunds"
              onChange={(checked) => updateSetting("managerApprovalForRefunds", checked)}
            />
            <ToggleSetting
              checked={settings.managerApprovalForVoids}
              label="Manager approval for voids"
              onChange={(checked) => updateSetting("managerApprovalForVoids", checked)}
            />
          </div>
        </SurfaceCard>

        <SurfaceCard className="store-info-section pos-settings-section" as="section">
          <SectionHeader
            eyebrow="Basket behaviour"
            title="How baskets live, hold, and expire"
            description="These settings are for abandoned baskets, held baskets, quotes, and line-level discipline."
          />
          <div className="purchase-form-grid store-info-grid">
            <ToggleSetting
              checked={settings.autoClearBasketAfterSale}
              label="Auto-clear basket after sale"
              description="Returns the till to a clean state as soon as payment completes."
              onChange={(checked) => updateSetting("autoClearBasketAfterSale", checked)}
            />
            <ToggleSetting
              checked={settings.requireLineNotes}
              label="Require line notes"
              description="Useful for service-heavy tills where every manual line needs context."
              onChange={(checked) => updateSetting("requireLineNotes", checked)}
            />
            <label>
              Held basket expiry (hours)
              <input
                min="1"
                max="720"
                step="1"
                type="number"
                value={settings.holdBasketTtlHours}
                onChange={(event) => updateNumberSetting("holdBasketTtlHours", event.target.value)}
              />
            </label>
            <label>
              Quote expiry (days)
              <input
                min="1"
                max="365"
                step="1"
                type="number"
                value={settings.quoteExpiryDays}
                onChange={(event) => updateNumberSetting("quoteExpiryDays", event.target.value)}
              />
            </label>
          </div>
        </SurfaceCard>

        <SurfaceCard className="store-info-section pos-settings-section" as="section">
          <SectionHeader
            eyebrow="Product search and scanning"
            title="Barcode and quick-add behaviour"
            description="Set how fast-scan workflows behave when a product is found more than once."
          />
          <div className="purchase-form-grid store-info-grid">
            <label>
              Scan quantity behaviour
              <select
                value={settings.scanQuantityMode}
                onChange={(event) =>
                  updateSetting("scanQuantityMode", event.target.value as PosSettings["scanQuantityMode"])}
              >
                <option value="INCREMENT_ONE">Add one per scan</option>
                <option value="PROMPT_QUANTITY">Prompt for quantity</option>
                <option value="USE_TYPED_QUANTITY">Use typed quantity</option>
              </select>
            </label>
            <label>
              Duplicate scan behaviour
              <select
                value={settings.duplicateScanBehavior}
                onChange={(event) =>
                  updateSetting(
                    "duplicateScanBehavior",
                    event.target.value as PosSettings["duplicateScanBehavior"],
                  )}
              >
                <option value="INCREMENT_QUANTITY">Increment existing line</option>
                <option value="ADD_SEPARATE_LINE">Add separate line</option>
                <option value="PROMPT">Ask staff each time</option>
              </select>
            </label>
            <ToggleSetting
              checked={settings.barcodeSearchAutoFocus}
              label="Focus search box when POS opens"
              description="Makes the scanner/search field ready without an extra click."
              onChange={(checked) => updateSetting("barcodeSearchAutoFocus", checked)}
            />
          </div>
        </SurfaceCard>

        <SurfaceCard className="store-info-section pos-settings-section" as="section">
          <SectionHeader
            eyebrow="Quick add"
            title="Choose the POS quick-add buttons"
            description="Search inventory and workshop service templates, then choose the buttons staff see on POS."
          />
          <div className="pos-quick-add-settings-panel">
            <ToggleSetting
              checked={settings.quickAddEnabled}
              label="Show quick-add products on POS"
              description="When enabled, these buttons appear under the search box for fast one-tap product entry."
              onChange={(checked) => updateSetting("quickAddEnabled", checked)}
            />

            <div className="pos-quick-add-search">
              <label>
                Search inventory and service templates
                <input
                  value={quickAddSearchText}
                  placeholder="Search by product, SKU, barcode, or service"
                  onChange={(event) => setQuickAddSearchText(event.target.value)}
                />
              </label>
              <div className="pos-quick-add-search-results" aria-live="polite">
                {quickAddSearchText.trim() ? (
                  quickAddSearchResults.length > 0 ? (
                    quickAddSearchResults.map((result) => {
                      const alreadyAdded = settings.quickAddProducts.some((entry) =>
                        getQuickAddEntryKey(entry) === getQuickAddEntryKey(result.entry),
                      );

                      return (
                        <div className="pos-quick-add-search-result" key={result.key}>
                          <div>
                            <span className="pos-quick-add-result-type">
                              {result.type === "SERVICE_TEMPLATE" ? "Service" : "Inventory"}
                            </span>
                            <strong>{result.label}</strong>
                            <span className="pos-settings-field-note">{result.detail}</span>
                          </div>
                          <span className="pos-quick-add-result-price">{formatMoney(result.pricePence)}</span>
                          <button
                            type="button"
                            onClick={() => addQuickAddProduct(result.entry)}
                            disabled={alreadyAdded || settings.quickAddProducts.length >= 12}
                          >
                            {alreadyAdded ? "Added" : "Add"}
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="empty-state compact">
                      {quickAddSearchLoading || templatesLoading
                        ? "Searching..."
                        : "No inventory items or service templates matched that search."}
                    </div>
                  )
                ) : (
                  <div className="empty-state compact">
                    Search to add stock items, SKUs, barcodes, or service templates.
                  </div>
                )}
              </div>
            </div>

            <div className="pos-quick-add-settings-list">
              {settings.quickAddProducts.length > 0 ? (
                settings.quickAddProducts.map((entry, index) => (
                  <div className="pos-quick-add-settings-row" key={`quick-add-${index}`}>
                    <label>
                      Button label
                      <input
                        maxLength={48}
                        value={entry.label}
                        placeholder="Inner Tube"
                        onChange={(event) => updateQuickAddProduct(index, "label", event.target.value)}
                      />
                    </label>
                    <label>
                      {entry.type === "SERVICE_TEMPLATE" ? "Service template" : "Product lookup"}
                      <input
                        maxLength={120}
                        value={entry.query}
                        placeholder={entry.type === "SERVICE_TEMPLATE" ? "Template name" : "Name, SKU, or barcode"}
                        onChange={(event) => updateQuickAddProduct(index, "query", event.target.value)}
                      />
                      <span className="pos-settings-field-note">
                        {entry.type === "SERVICE_TEMPLATE"
                          ? "POS applies the required lines from this service template."
                          : "POS uses this to search products and picks the best match."}
                      </span>
                    </label>
                    <button
                      type="button"
                      className="pos-quick-add-remove"
                      onClick={() => removeQuickAddProduct(index)}
                      aria-label={`Remove quick-add product ${entry.label || index + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty-state compact">
                  No quick-add buttons are configured. Add one to make it appear on POS.
                </div>
              )}
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard className="store-info-section pos-settings-section" as="section">
          <SectionHeader
            eyebrow="Payment and tender"
            title="How payment options appear"
            description="Choose the tender methods staff can use and how payment completion should behave."
          />
          <div className="purchase-form-grid store-info-grid">
            <fieldset className="store-info-grid-span pos-settings-fieldset">
              <legend>Enabled payment options</legend>
              <div className="pos-settings-checkbox-grid">
                {TENDER_OPTIONS.map((option) => (
                  <label key={option.value} className="store-settings-checkbox">
                    <input
                      type="checkbox"
                      checked={settings.enabledTenderMethods.includes(option.value)}
                      onChange={(event) => toggleTenderMethod(option.value, event.target.checked)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label>
              Cash rounding
              <select
                value={settings.cashRoundingMode}
                onChange={(event) =>
                  updateSetting("cashRoundingMode", event.target.value as PosSettings["cashRoundingMode"])}
              >
                <option value="NONE">No rounding</option>
                <option value="NEAREST_5P">Nearest 5p</option>
                <option value="NEAREST_10P">Nearest 10p</option>
              </select>
            </label>

            <ToggleSetting
              checked={settings.splitPaymentsEnabled}
              label="Allow split payments"
              description="Allows staff to tender the same sale across multiple payment methods."
              onChange={(checked) => updateSetting("splitPaymentsEnabled", checked)}
            />
            <ToggleSetting
              checked={settings.promptForReceiptAfterPayment}
              label="Prompt for receipt after payment"
              description="Keeps the receipt choice visible at the end of checkout."
              onChange={(checked) => updateSetting("promptForReceiptAfterPayment", checked)}
            />
          </div>
        </SurfaceCard>

        <SurfaceCard className="store-info-section pos-settings-section" as="section">
          <SectionHeader
            eyebrow="Staff controls"
            title="PINs, overrides, and till timeout"
            description="Use these controls for checkout authority and unattended-till hygiene."
          />
          <div className="purchase-form-grid store-info-grid">
            <ToggleSetting
              checked={settings.requirePinForCheckout}
              label="Require staff PIN for checkout"
              description="Adds a fast staff-auth checkpoint before completing a sale."
              onChange={(checked) => updateSetting("requirePinForCheckout", checked)}
            />
            <ToggleSetting
              checked={settings.requireManagerOverrideForRestrictedActions}
              label="Manager override for restricted actions"
              description="Applies to restricted refunds, voids, discounts, and exception workflows."
              onChange={(checked) => updateSetting("requireManagerOverrideForRestrictedActions", checked)}
            />
            <label>
              Till lock timeout (seconds)
              <input
                min="15"
                max="86400"
                step="15"
                type="number"
                value={settings.tillLockTimeoutSeconds}
                onChange={(event) => updateNumberSetting("tillLockTimeoutSeconds", event.target.value)}
              />
            </label>
          </div>
        </SurfaceCard>

        <SurfaceCard className="store-info-section pos-settings-section" as="section">
          <SectionHeader
            eyebrow="Display preferences"
            title="What the till shows by default"
            description="Keep the sales screen focused for busy counter work without hiding useful guidance."
          />
          <div className="purchase-form-grid store-info-grid">
            <ToggleSetting
              checked={settings.compactBasketView}
              label="Use compact basket view"
              description="Prioritises more basket lines on screen when the till gets busy."
              onChange={(checked) => updateSetting("compactBasketView", checked)}
            />
            <ToggleSetting
              checked={settings.showKeyboardShortcutHints}
              label="Show keyboard shortcut hints"
              description="Shows F-key and shortcut hints for staff who use the keyboard."
              onChange={(checked) => updateSetting("showKeyboardShortcutHints", checked)}
            />
          </div>
        </SurfaceCard>

        <div className="actions-inline pos-settings-actions">
          <button type="button" onClick={resetChanges} disabled={!isDirty || saving || loading}>
            Reset
          </button>
          <button className="primary" type="submit" disabled={!isDirty || saving || loading}>
            {saving ? "Saving..." : "Save POS settings"}
          </button>
        </div>
      </form>
    </div>
  );
};
