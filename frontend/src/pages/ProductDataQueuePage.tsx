import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";

type VariantRow = {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  name: string | null;
  option: string | null;
  retailPrice: string;
  retailPricePence: number;
  costPricePence: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  product?: {
    id: string;
    name: string;
    category: string | null;
    brand: string | null;
  };
};

type VariantListResponse = {
  variants: VariantRow[];
};

type InventoryOnHandRow = {
  variantId: string;
  onHand: number;
  isActive: boolean;
};

type InventorySearchResponse = {
  rows: InventoryOnHandRow[];
};

type ProductResponse = {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  variantCount?: number;
};

const LOW_STOCK_THRESHOLD = 3;

type CatalogueForm = {
  productId?: string;
  variantId?: string;
  name: string;
  sku: string;
  barcode: string;
  retailPrice: string;
  category: string;
  isActive: boolean;
};

const emptyForm = (): CatalogueForm => ({
  name: "",
  sku: "",
  barcode: "",
  retailPrice: "",
  category: "",
  isActive: true,
});

const normalizeCatalogScope = (value: string) => (value === "all" ? "all" : "active");

const normalizeText = (value: string) => value.trim();

const normalizeRetailPrice = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return trimmed;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const formatDate = (value: string) => new Date(value).toLocaleDateString();

const getStockStateLabel = (onHand: number) => {
  if (onHand < 0) return "Negative";
  if (onHand === 0) return "Zero Stock";
  if (onHand <= LOW_STOCK_THRESHOLD) return "Low Stock";
  return "In Stock";
};

const getStockStateClass = (onHand: number) => {
  if (onHand < 0) return "stock-badge stock-state-negative";
  if (onHand === 0) return "stock-badge stock-state-zero";
  if (onHand <= LOW_STOCK_THRESHOLD) return "stock-badge stock-state-low";
  return "stock-badge stock-state-positive";
};

export const ProductDataQueuePage = () => {
  const { error, success } = useToasts();
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [stockByVariantId, setStockByVariantId] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [catalogScope, setCatalogScope] = useState<"active" | "all">("active");
  const [searchText, setSearchText] = useState("");
  const debouncedSearch = useDebouncedValue(searchText, 250);
  const [createForm, setCreateForm] = useState<CatalogueForm>(emptyForm());
  const [editForm, setEditForm] = useState<CatalogueForm | null>(null);

  const loadVariants = async () => {
    setLoading(true);
    try {
      const scope = normalizeCatalogScope(catalogScope);
      const query = new URLSearchParams();
      query.set("take", "250");
      query.set("skip", "0");
      if (scope === "active") {
        query.set("active", "1");
      }
      if (debouncedSearch.trim()) {
        query.set("q", debouncedSearch.trim());
      }
      const inventoryQuery = new URLSearchParams(query);
      const [variantPayload, inventoryPayload] = await Promise.all([
        apiGet<VariantListResponse>(`/api/variants?${query.toString()}`),
        apiGet<InventorySearchResponse>(`/api/inventory/on-hand/search?${inventoryQuery.toString()}`),
      ]);
      setVariants(variantPayload.variants || []);
      setStockByVariantId(
        Object.fromEntries((inventoryPayload.rows || []).map((row) => [row.variantId, row.onHand])),
      );
    } catch (loadError) {
      setVariants([]);
      setStockByVariantId({});
      error(loadError instanceof Error ? loadError.message : "Failed to load product catalogue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadVariants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogScope, debouncedSearch]);

  const issueSummary = useMemo(() => ({
    missingBarcode: variants.filter((variant) => !variant.barcode).length,
    missingCost: variants.filter((variant) => variant.costPricePence === null).length,
    missingPrice: variants.filter((variant) => variant.retailPricePence <= 0).length,
    inactive: variants.filter((variant) => !variant.isActive).length,
  }), [variants]);

  const stockSummary = useMemo(() => ({
    inStock: variants.filter((variant) => (stockByVariantId[variant.id] ?? 0) > LOW_STOCK_THRESHOLD).length,
    low: variants.filter((variant) => {
      const onHand = stockByVariantId[variant.id] ?? 0;
      return onHand > 0 && onHand <= LOW_STOCK_THRESHOLD;
    }).length,
    zero: variants.filter((variant) => (stockByVariantId[variant.id] ?? 0) === 0).length,
    negative: variants.filter((variant) => (stockByVariantId[variant.id] ?? 0) < 0).length,
  }), [stockByVariantId, variants]);

  const startEdit = (variant: VariantRow) => {
    setEditForm({
      productId: variant.productId,
      variantId: variant.id,
      name: variant.product?.name ?? "",
      sku: variant.sku,
      barcode: variant.barcode ?? "",
      retailPrice: variant.retailPrice,
      category: variant.product?.category ?? "",
      isActive: variant.isActive,
    });
  };

  const validateForm = (form: CatalogueForm) => {
    const name = normalizeText(form.name);
    const sku = normalizeText(form.sku);
    const retailPrice = normalizeRetailPrice(form.retailPrice);

    if (!name) {
      throw new Error("Product name is required");
    }
    if (!sku) {
      throw new Error("SKU is required");
    }
    if (!retailPrice) {
      throw new Error("Retail price must be a valid amount");
    }

    return {
      name,
      sku,
      barcode: normalizeText(form.barcode) || undefined,
      retailPrice,
      category: normalizeText(form.category) || undefined,
      isActive: form.isActive,
    };
  };

  const createProduct = async () => {
    try {
      const payload = validateForm(createForm);
      setSaving(true);
      await apiPost<ProductResponse>("/api/products", {
        name: payload.name,
        category: payload.category,
        isActive: payload.isActive,
        defaultVariant: {
          sku: payload.sku,
          barcode: payload.barcode,
          retailPrice: payload.retailPrice,
          isActive: payload.isActive,
        },
      });
      success("Product created");
      setCreateForm(emptyForm());
      await loadVariants();
    } catch (createError) {
      error(createError instanceof Error ? createError.message : "Failed to create product");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editForm?.productId || !editForm.variantId) {
      error("Select a product to edit");
      return;
    }

    try {
      const payload = validateForm(editForm);
      setSaving(true);
      await apiPatch(`/api/variants/${editForm.variantId}`, {
        sku: payload.sku,
        barcode: payload.barcode ?? null,
        retailPrice: payload.retailPrice,
        isActive: payload.isActive,
      });
      await apiPatch(`/api/products/${editForm.productId}`, {
        name: payload.name,
        category: payload.category ?? null,
        isActive: payload.isActive,
      });
      success("Product updated");
      setEditForm(null);
      await loadVariants();
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to update product");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell product-catalogue-page">
      <section className="card product-catalogue-create-card">
        <div className="card-header-row">
          <div>
            <h1>Product Catalogue</h1>
            <p className="muted-text">
              Create and maintain the sellable product records that drive POS search. Each entry creates or updates the product plus its default POS variant.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadVariants()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="product-catalogue-form-grid">
          <label>
            Product name
            <input
              value={createForm.name}
              onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="e.g. Shimano Disc Brake Pads"
            />
          </label>
          <label>
            SKU
            <input
              value={createForm.sku}
              onChange={(event) => setCreateForm((current) => ({ ...current, sku: event.target.value }))}
              placeholder="SKU-001"
            />
          </label>
          <label>
            Barcode
            <input
              value={createForm.barcode}
              onChange={(event) => setCreateForm((current) => ({ ...current, barcode: event.target.value }))}
              placeholder="Optional"
            />
          </label>
          <label>
            Retail price
            <input
              value={createForm.retailPrice}
              onChange={(event) => setCreateForm((current) => ({ ...current, retailPrice: event.target.value }))}
              placeholder="0.00"
              inputMode="decimal"
            />
          </label>
          <label>
            Category
            <input
              value={createForm.category}
              onChange={(event) => setCreateForm((current) => ({ ...current, category: event.target.value }))}
              placeholder="Components"
            />
          </label>
          <label className="product-catalogue-status-field">
            Status
            <select
              value={createForm.isActive ? "active" : "inactive"}
              onChange={(event) => setCreateForm((current) => ({
                ...current,
                isActive: event.target.value === "active",
              }))}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>

        <div className="actions-inline">
          <button type="button" className="primary" onClick={() => void createProduct()} disabled={saving}>
            {saving ? "Saving..." : "Create product"}
          </button>
          <button type="button" onClick={() => setCreateForm(emptyForm())} disabled={saving}>
            Reset
          </button>
        </div>
      </section>

      {editForm ? (
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Edit Product</h2>
              <p className="muted-text">Update the product record and its default POS variant together.</p>
            </div>
            <div className="actions-inline">
              <button type="button" onClick={() => setEditForm(null)} disabled={saving}>Cancel</button>
            </div>
          </div>

          <div className="product-catalogue-form-grid">
            <label>
              Product name
              <input
                value={editForm.name}
                onChange={(event) => setEditForm((current) => current ? { ...current, name: event.target.value } : current)}
              />
            </label>
            <label>
              SKU
              <input
                value={editForm.sku}
                onChange={(event) => setEditForm((current) => current ? { ...current, sku: event.target.value } : current)}
              />
            </label>
            <label>
              Barcode
              <input
                value={editForm.barcode}
                onChange={(event) => setEditForm((current) => current ? { ...current, barcode: event.target.value } : current)}
              />
            </label>
            <label>
              Retail price
              <input
                value={editForm.retailPrice}
                onChange={(event) => setEditForm((current) => current ? { ...current, retailPrice: event.target.value } : current)}
                inputMode="decimal"
              />
            </label>
            <label>
              Category
              <input
                value={editForm.category}
                onChange={(event) => setEditForm((current) => current ? { ...current, category: event.target.value } : current)}
              />
            </label>
            <label className="product-catalogue-status-field">
              Status
              <select
                value={editForm.isActive ? "active" : "inactive"}
                onChange={(event) => setEditForm((current) => current ? {
                  ...current,
                  isActive: event.target.value === "active",
                } : current)}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>

          <div className="actions-inline">
            <button type="button" className="primary" onClick={() => void saveEdit()} disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </button>
            <Link to="/pos">Check POS search</Link>
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Catalogue List</h2>
            <p className="muted-text">Search by product name, SKU, barcode, brand, or category.</p>
          </div>
        </div>

        <div className="filter-row">
          <label className="grow">
            Search catalogue
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="product, SKU, barcode, category"
            />
          </label>
          <label>
            Scope
            <select
              value={catalogScope}
              onChange={(event) => setCatalogScope(normalizeCatalogScope(event.target.value))}
            >
              <option value="active">Active only</option>
              <option value="all">All products</option>
            </select>
          </label>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>SKU</th>
                <th>Barcode</th>
                <th>Retail</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {variants.length === 0 ? (
                <tr>
                  <td colSpan={8}>{loading ? "Loading catalogue..." : "No products match the current search."}</td>
                </tr>
              ) : variants.map((variant) => (
                <tr key={variant.id}>
                  <td>
                    <div className="table-primary">{variant.product?.name ?? "Unknown product"}</div>
                    <div className="table-secondary">{variant.product?.brand ?? variant.option ?? "Default variant"}</div>
                  </td>
                  <td>{variant.product?.category ?? "-"}</td>
                  <td className="mono-text">{variant.sku}</td>
                  <td className="mono-text">{variant.barcode ?? "-"}</td>
                  <td>{formatMoney(variant.retailPricePence)}</td>
                  <td>
                    <span className={variant.isActive ? "product-status-badge product-status-badge-active" : "product-status-badge product-status-badge-inactive"}>
                      {variant.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>{formatDate(variant.updatedAt)}</td>
                  <td>
                    <div className="actions-inline">
                      <button type="button" onClick={() => startEdit(variant)}>Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Data Quality Attention</h2>
            <p className="muted-text">Quick scan of catalogue records that are likely to cause selling or purchasing friction.</p>
          </div>
          <div className="actions-inline">
            <Link to="/inventory">Inventory</Link>
            <Link to="/purchasing">Purchasing</Link>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Missing barcode</span>
            <strong className="metric-value">{issueSummary.missingBarcode}</strong>
            <span className="dashboard-metric-detail">Harder to scan at the till</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Missing cost</span>
            <strong className="metric-value">{issueSummary.missingCost}</strong>
            <span className="dashboard-metric-detail">Purchasing margin blind spot</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Missing retail price</span>
            <strong className="metric-value">{issueSummary.missingPrice}</strong>
            <span className="dashboard-metric-detail">Not POS-ready</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Inactive variants in scope</span>
            <strong className="metric-value">{issueSummary.inactive}</strong>
            <span className="dashboard-metric-detail">Review before relying on POS search</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">In stock</span>
            <strong className="metric-value">{stockSummary.inStock}</strong>
            <span className="dashboard-metric-detail">Variants above the low-stock threshold</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Low stock</span>
            <strong className="metric-value">{stockSummary.low}</strong>
            <span className="dashboard-metric-detail">On hand greater than 0 and less than or equal to {LOW_STOCK_THRESHOLD}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Zero stock</span>
            <strong className="metric-value">{stockSummary.zero}</strong>
            <span className="dashboard-metric-detail">Variants needing replenishment review</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Negative stock</span>
            <strong className="metric-value">{stockSummary.negative}</strong>
            <span className="dashboard-metric-detail">Variants needing investigation</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Stock Visibility</h2>
            <p className="muted-text">View on-hand state from the catalogue and jump directly into stock adjustment or movement history.</p>
          </div>
          <div className="actions-inline">
            <Link to="/inventory">Inventory overview</Link>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>SKU</th>
                <th>On Hand</th>
                <th>Stock State</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {variants.length === 0 ? (
                <tr>
                  <td colSpan={6}>{loading ? "Loading stock visibility..." : "No products match the current search."}</td>
                </tr>
              ) : variants.map((variant) => {
                const onHand = stockByVariantId[variant.id] ?? 0;
                return (
                  <tr key={`stock-${variant.id}`}>
                    <td>
                      <div className="table-primary">{variant.product?.name ?? "Unknown product"}</div>
                      <div className="table-secondary">{variant.product?.brand ?? variant.option ?? "Default variant"}</div>
                    </td>
                    <td>{variant.product?.category ?? "-"}</td>
                    <td className="mono-text">{variant.sku}</td>
                    <td className="numeric-cell">{onHand}</td>
                    <td>
                      <span className={getStockStateClass(onHand)}>{getStockStateLabel(onHand)}</span>
                    </td>
                    <td>
                      <div className="actions-inline">
                        <Link className="button-link button-link-compact" to={`/inventory/${variant.id}`}>
                          Adjust stock
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
