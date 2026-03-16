import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

type Supplier = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes?: string | null;
};

type SupplierListResponse = {
  suppliers: Supplier[];
};

type PurchaseOrderItem = {
  id: string;
  purchaseOrderId: string;
  variantId: string;
  sku: string;
  variantName: string | null;
  productId: string;
  productName: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityRemaining: number;
  unitCostPence: number | null;
  createdAt: string;
  updatedAt: string;
};

type PurchaseOrder = {
  id: string;
  supplierId: string;
  supplier: Supplier;
  status: string;
  orderedAt: string | null;
  expectedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: PurchaseOrderItem[];
  totals: {
    quantityOrdered: number;
    quantityReceived: number;
    quantityRemaining: number;
  };
};

type PurchaseOrderListResponse = {
  purchaseOrders: PurchaseOrder[];
};

type SupplierProductLink = {
  id: string;
  supplierId: string;
  supplierName: string;
  variantId: string;
  productId: string;
  productName: string;
  productCategory: string | null;
  productBrand: string | null;
  sku: string;
  barcode: string | null;
  variantName: string | null;
  variantOption: string | null;
  variantCostPricePence: number | null;
  retailPricePence: number;
  supplierProductCode: string | null;
  supplierCostPence: number | null;
  preferredSupplier: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type SupplierProductLinkListResponse = {
  supplierProductLinks: SupplierProductLink[];
};

type VariantSearchRow = {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  name: string | null;
  option: string | null;
  retailPricePence: number;
  costPricePence: number | null;
  isActive: boolean;
  product?: {
    id: string;
    name: string;
    brand: string | null;
  };
};

type VariantListResponse = {
  variants: VariantSearchRow[];
};

type SelectedVariant = {
  id: string;
  productId: string;
  productName: string;
  variantName: string | null;
  variantOption: string | null;
  sku: string;
  barcode: string | null;
  costPricePence: number | null;
};

type LinkFormState = {
  linkId: string | null;
  supplierProductCode: string;
  supplierCostPence: string;
  preferredSupplier: boolean;
  isActive: boolean;
};

type IntakeRow = {
  key: string;
  supplierId: string;
  supplierName: string;
  variantId: string;
  productId: string;
  productName: string;
  variantName: string | null;
  sku: string;
  totalOrdered: number;
  totalReceived: number;
  orderCount: number;
  latestPurchaseOrderId: string;
  latestExpectedAt: string | null;
  latestCreatedAt: string;
  hasMissingCost: boolean;
  supplierLink: SupplierProductLink | null;
};

type LinkStatusFilter = "all" | "linked" | "unlinked";

const emptyLinkForm = (): LinkFormState => ({
  linkId: null,
  supplierProductCode: "",
  supplierCostPence: "",
  preferredSupplier: false,
  isActive: true,
});

const formatMoney = (pence: number | null) => (pence === null ? "-" : `£${(pence / 100).toFixed(2)}`);
const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "-");
const toLinkKey = (supplierId: string, variantId: string) => `${supplierId}:${variantId}`;

const toSelectedVariantFromSearch = (variant: VariantSearchRow): SelectedVariant => ({
  id: variant.id,
  productId: variant.productId,
  productName: variant.product?.name || "-",
  variantName: variant.name,
  variantOption: variant.option,
  sku: variant.sku,
  barcode: variant.barcode,
  costPricePence: variant.costPricePence,
});

const toSelectedVariantFromLink = (link: SupplierProductLink): SelectedVariant => ({
  id: link.variantId,
  productId: link.productId,
  productName: link.productName,
  variantName: link.variantName,
  variantOption: link.variantOption,
  sku: link.sku,
  barcode: link.barcode,
  costPricePence: link.variantCostPricePence,
});

const toLinkForm = (link: SupplierProductLink): LinkFormState => ({
  linkId: link.id,
  supplierProductCode: link.supplierProductCode ?? "",
  supplierCostPence: link.supplierCostPence === null ? "" : String(link.supplierCostPence),
  preferredSupplier: link.preferredSupplier,
  isActive: link.isActive,
});

export const SupplierCataloguePage = () => {
  const { error, success } = useToasts();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [supplierLinks, setSupplierLinks] = useState<SupplierProductLink[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [supplierFilterId, setSupplierFilterId] = useState("");
  const [linkStatusFilter, setLinkStatusFilter] = useState<LinkStatusFilter>("all");
  const [loading, setLoading] = useState(false);

  const [linkSupplierId, setLinkSupplierId] = useState("");
  const [variantSearch, setVariantSearch] = useState("");
  const debouncedVariantSearch = useDebouncedValue(variantSearch, 250);
  const [variantResults, setVariantResults] = useState<VariantSearchRow[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<SelectedVariant | null>(null);
  const [linkForm, setLinkForm] = useState<LinkFormState>(emptyLinkForm());
  const [savingLink, setSavingLink] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [supplierPayload, poPayload, linkPayload] = await Promise.all([
        apiGet<SupplierListResponse>("/api/suppliers"),
        apiGet<PurchaseOrderListResponse>("/api/purchase-orders?take=200&skip=0"),
        apiGet<SupplierProductLinkListResponse>("/api/supplier-product-links?take=500&skip=0"),
      ]);

      const nextSuppliers = supplierPayload.suppliers || [];
      setSuppliers(nextSuppliers);
      setPurchaseOrders(poPayload.purchaseOrders || []);
      setSupplierLinks(linkPayload.supplierProductLinks || []);
      setLinkSupplierId((current) => {
        if (current && nextSuppliers.some((supplier) => supplier.id === current)) {
          return current;
        }
        if (supplierFilterId && nextSuppliers.some((supplier) => supplier.id === supplierFilterId)) {
          return supplierFilterId;
        }
        return nextSuppliers[0]?.id ?? "";
      });
    } catch (loadError) {
      setSuppliers([]);
      setPurchaseOrders([]);
      setSupplierLinks([]);
      error(loadError instanceof Error ? loadError.message : "Failed to load supplier catalogue intake data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!linkSupplierId || !debouncedVariantSearch.trim()) {
      setVariantResults([]);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const payload = await apiGet<VariantListResponse>(
          `/api/variants?q=${encodeURIComponent(debouncedVariantSearch.trim())}&active=1&take=20&skip=0`,
        );
        if (!cancelled) {
          setVariantResults(payload.variants || []);
        }
      } catch (searchError) {
        if (!cancelled) {
          setVariantResults([]);
          error(searchError instanceof Error ? searchError.message : "Failed to search variants");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [debouncedVariantSearch, error, linkSupplierId]);

  const supplierLinkByKey = useMemo(() => (
    new Map(supplierLinks.map((link) => [toLinkKey(link.supplierId, link.variantId), link]))
  ), [supplierLinks]);

  const intakeRows = useMemo(() => {
    const map = new Map<string, Omit<IntakeRow, "supplierLink">>();

    for (const purchaseOrder of purchaseOrders) {
      for (const item of purchaseOrder.items) {
        const key = toLinkKey(purchaseOrder.supplierId, item.variantId);
        const existing = map.get(key);
        if (!existing) {
          map.set(key, {
            key,
            supplierId: purchaseOrder.supplierId,
            supplierName: purchaseOrder.supplier.name,
            variantId: item.variantId,
            productId: item.productId,
            productName: item.productName,
            variantName: item.variantName,
            sku: item.sku,
            totalOrdered: item.quantityOrdered,
            totalReceived: item.quantityReceived,
            orderCount: 1,
            latestPurchaseOrderId: purchaseOrder.id,
            latestExpectedAt: purchaseOrder.expectedAt,
            latestCreatedAt: purchaseOrder.createdAt,
            hasMissingCost: item.unitCostPence === null,
          });
          continue;
        }

        existing.totalOrdered += item.quantityOrdered;
        existing.totalReceived += item.quantityReceived;
        existing.orderCount += 1;
        existing.hasMissingCost = existing.hasMissingCost || item.unitCostPence === null;
        if (new Date(purchaseOrder.createdAt).getTime() > new Date(existing.latestCreatedAt).getTime()) {
          existing.latestPurchaseOrderId = purchaseOrder.id;
          existing.latestExpectedAt = purchaseOrder.expectedAt;
          existing.latestCreatedAt = purchaseOrder.createdAt;
        }
      }
    }

    const needle = debouncedSearch.trim().toLowerCase();

    return Array.from(map.values())
      .map((row) => ({
        ...row,
        supplierLink: supplierLinkByKey.get(row.key) ?? null,
      }))
      .filter((row) => {
        if (supplierFilterId && row.supplierId !== supplierFilterId) {
          return false;
        }
        if (linkStatusFilter === "linked" && !row.supplierLink) {
          return false;
        }
        if (linkStatusFilter === "unlinked" && row.supplierLink) {
          return false;
        }
        if (!needle) {
          return true;
        }
        const haystack = [
          row.supplierName,
          row.productName,
          row.variantName ?? "",
          row.sku,
          row.supplierLink?.supplierProductCode ?? "",
        ].join(" ").toLowerCase();
        return haystack.includes(needle);
      })
      .sort((left, right) => (
        Number(!left.supplierLink) - Number(!right.supplierLink)
        || Number(right.hasMissingCost) - Number(left.hasMissingCost)
        || right.orderCount - left.orderCount
        || right.totalOrdered - left.totalOrdered
        || left.supplierName.localeCompare(right.supplierName)
        || left.productName.localeCompare(right.productName)
      ));
  }, [debouncedSearch, linkStatusFilter, purchaseOrders, supplierFilterId, supplierLinkByKey]);

  const linkedRows = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    return supplierLinks
      .filter((row) => !supplierFilterId || row.supplierId === supplierFilterId)
      .filter((row) => {
        if (!needle) {
          return true;
        }
        const haystack = [
          row.supplierName,
          row.productName,
          row.variantName ?? "",
          row.sku,
          row.supplierProductCode ?? "",
        ].join(" ").toLowerCase();
        return haystack.includes(needle);
      })
      .sort((left, right) => (
        Number(right.preferredSupplier) - Number(left.preferredSupplier)
        || Number(right.isActive) - Number(left.isActive)
        || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      ));
  }, [debouncedSearch, supplierFilterId, supplierLinks]);

  const attentionRows = intakeRows
    .filter((row) => row.hasMissingCost || row.totalReceived < row.totalOrdered || !row.supplierLink)
    .slice(0, 25);
  const topRows = intakeRows.slice(0, 25);

  const summary = useMemo(() => ({
    supplierCount: suppliers.length,
    intakeRowCount: intakeRows.length,
    activeLinkCount: supplierLinks.filter((link) => link.isActive).length,
    preferredLinkCount: supplierLinks.filter((link) => link.preferredSupplier && link.isActive).length,
    intakeWithoutLinkCount: intakeRows.filter((row) => !row.supplierLink).length,
  }), [intakeRows, supplierLinks, suppliers.length]);

  const selectVariantForLink = (variant: SelectedVariant, existingLink: SupplierProductLink | null) => {
    setSelectedVariant(variant);
    setLinkForm(existingLink ? toLinkForm(existingLink) : emptyLinkForm());
  };

  const handleSupplierChange = (value: string) => {
    setLinkSupplierId(value);
    setSelectedVariant(null);
    setLinkForm(emptyLinkForm());
    setVariantSearch("");
    setVariantResults([]);
  };

  const startEditingLink = (link: SupplierProductLink) => {
    setLinkSupplierId(link.supplierId);
    selectVariantForLink(toSelectedVariantFromLink(link), link);
  };

  const resetLinkBuilder = () => {
    setSelectedVariant(null);
    setLinkForm(emptyLinkForm());
    setVariantSearch("");
    setVariantResults([]);
  };

  const saveLink = async () => {
    if (!linkSupplierId) {
      error("Choose a supplier before saving a supplier link.");
      return;
    }
    if (!selectedVariant) {
      error("Choose a variant before saving a supplier link.");
      return;
    }

    const normalizedSupplierCode = linkForm.supplierProductCode.trim();
    const parsedSupplierCost = linkForm.supplierCostPence.trim().length > 0
      ? Number.parseInt(linkForm.supplierCostPence, 10)
      : null;

    if (
      parsedSupplierCost !== null
      && (!Number.isInteger(parsedSupplierCost) || parsedSupplierCost < 0)
    ) {
      error("Supplier cost must be a non-negative integer in pence.");
      return;
    }

    setSavingLink(true);
    try {
      const payload = {
        supplierProductCode: normalizedSupplierCode || null,
        supplierCostPence: parsedSupplierCost,
        preferredSupplier: linkForm.preferredSupplier,
        isActive: linkForm.isActive,
      };

      const savedLink = linkForm.linkId
        ? await apiPatch<SupplierProductLink>(
            `/api/supplier-product-links/${encodeURIComponent(linkForm.linkId)}`,
            payload,
          )
        : await apiPost<SupplierProductLink>("/api/supplier-product-links", {
            supplierId: linkSupplierId,
            variantId: selectedVariant.id,
            ...payload,
          });

      setSupplierLinks((current) => {
        const next = current
          .filter((row) => row.id !== savedLink.id)
          .map((row) => (
            savedLink.preferredSupplier && row.variantId === savedLink.variantId
              ? { ...row, preferredSupplier: row.id === savedLink.id ? row.preferredSupplier : false }
              : row
          ));
        return [savedLink, ...next];
      });
      setSelectedVariant(toSelectedVariantFromLink(savedLink));
      setLinkForm(toLinkForm(savedLink));
      success(linkForm.linkId ? "Supplier link updated" : "Supplier link created");
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save supplier link");
    } finally {
      setSavingLink(false);
    }
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Supplier Catalogue / Intake</h1>
            <p className="muted-text">
              Manager-facing supplier intake view using current suppliers, purchase order history, and manual supplier-product links. This stays operational and internal rather than introducing feeds or supplier automation.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management">Back to management</Link>
            <Link to="/purchasing">Open purchasing</Link>
            <button type="button" onClick={() => void loadData()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="filter-row">
          <label className="grow">
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Supplier, product, variant, SKU, supplier code"
            />
          </label>
          <label>
            Supplier
            <select
              value={supplierFilterId}
              onChange={(event) => setSupplierFilterId(event.target.value)}
            >
              <option value="">All suppliers</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Link Status
            <select
              value={linkStatusFilter}
              onChange={(event) => setLinkStatusFilter(event.target.value as LinkStatusFilter)}
            >
              <option value="all">All intake rows</option>
              <option value="linked">Linked only</option>
              <option value="unlinked">Needs link</option>
            </select>
          </label>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Suppliers</span>
            <strong className="metric-value">{summary.supplierCount}</strong>
            <span className="dashboard-metric-detail">Suppliers visible to purchasing</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Tracked Intake Rows</span>
            <strong className="metric-value">{summary.intakeRowCount}</strong>
            <span className="dashboard-metric-detail">Supplier + variant purchase history rows</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Active Links</span>
            <strong className="metric-value">{summary.activeLinkCount}</strong>
            <span className="dashboard-metric-detail">Supplier-specific purchasing records currently usable</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Needs Link</span>
            <strong className="metric-value">{summary.intakeWithoutLinkCount}</strong>
            <span className="dashboard-metric-detail">Purchasing history rows still missing a supplier link</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Supplier Link Builder</h2>
              <p className="muted-text">
                Create or update supplier-specific product codes and costs for future purchasing and supplier-import groundwork.
              </p>
            </div>
            {selectedVariant ? (
              <button type="button" onClick={resetLinkBuilder}>
                Clear Selection
              </button>
            ) : null}
          </div>

          <div className="filter-row">
            <label>
              Supplier
              <select
                value={linkSupplierId}
                onChange={(event) => handleSupplierChange(event.target.value)}
              >
                <option value="">Select supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grow">
              Search Variant
              <input
                value={variantSearch}
                onChange={(event) => setVariantSearch(event.target.value)}
                placeholder="SKU, barcode, product, variant"
                disabled={!linkSupplierId}
              />
            </label>
          </div>

          {selectedVariant ? (
            <div className="restricted-panel info-panel" style={{ marginBottom: "12px" }}>
              <strong>{selectedVariant.productName}</strong>
              <div>{selectedVariant.variantName || selectedVariant.variantOption || "Unnamed variant"}</div>
              <div className="mono-text">{selectedVariant.sku}</div>
              <div>Variant cost: {formatMoney(selectedVariant.costPricePence)}</div>
            </div>
          ) : (
            <p className="muted-text">Choose a supplier and search for a variant to create or update a supplier link.</p>
          )}

          <div className="purchase-form-grid">
            <label>
              Supplier Product Code
              <input
                value={linkForm.supplierProductCode}
                onChange={(event) => setLinkForm((current) => ({
                  ...current,
                  supplierProductCode: event.target.value,
                }))}
                placeholder="supplier code / trade ref"
                disabled={!selectedVariant}
              />
            </label>
            <label>
              Supplier Cost (pence)
              <input
                type="number"
                min="0"
                step="1"
                value={linkForm.supplierCostPence}
                onChange={(event) => setLinkForm((current) => ({
                  ...current,
                  supplierCostPence: event.target.value,
                }))}
                placeholder="optional"
                disabled={!selectedVariant}
              />
            </label>
            <label>
              <span>Preferred Supplier</span>
              <input
                type="checkbox"
                checked={linkForm.preferredSupplier}
                onChange={(event) => setLinkForm((current) => ({
                  ...current,
                  preferredSupplier: event.target.checked,
                }))}
                disabled={!selectedVariant || !linkForm.isActive}
              />
            </label>
            <label>
              <span>Active Link</span>
              <input
                type="checkbox"
                checked={linkForm.isActive}
                onChange={(event) => setLinkForm((current) => ({
                  ...current,
                  isActive: event.target.checked,
                  preferredSupplier: event.target.checked ? current.preferredSupplier : false,
                }))}
                disabled={!selectedVariant}
              />
            </label>
          </div>

          <div className="actions-inline" style={{ marginBottom: "12px" }}>
            <button
              type="button"
              className="primary"
              onClick={() => void saveLink()}
              disabled={!selectedVariant || savingLink}
            >
              {savingLink ? "Saving..." : linkForm.linkId ? "Update Link" : "Create Link"}
            </button>
            {selectedVariant ? (
              <Link to={`/inventory/${selectedVariant.id}`}>Open inventory item</Link>
            ) : null}
            <Link to="/management/product-data">Open product data queue</Link>
          </div>

          {variantResults.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Variant</th>
                    <th>SKU</th>
                    <th>Current Cost</th>
                    <th>Existing Link</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {variantResults.map((variant) => {
                    const existingLink = supplierLinkByKey.get(toLinkKey(linkSupplierId, variant.id)) ?? null;
                    return (
                      <tr key={variant.id}>
                        <td>
                          <div className="table-primary">{variant.product?.name || "-"}</div>
                          <div className="table-secondary">{variant.product?.brand || "-"}</div>
                        </td>
                        <td>{variant.name || variant.option || "-"}</td>
                        <td className="mono-text">{variant.sku}</td>
                        <td>{formatMoney(variant.costPricePence)}</td>
                        <td>
                          {existingLink ? (
                            <>
                              <div>{existingLink.supplierProductCode || "No supplier code"}</div>
                              <div className="table-secondary">
                                {formatMoney(existingLink.supplierCostPence)} | {existingLink.isActive ? "Active" : "Inactive"}
                              </div>
                            </>
                          ) : (
                            <span className="table-secondary">No supplier link yet</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => selectVariantForLink(toSelectedVariantFromSearch(variant), existingLink)}
                          >
                            {existingLink ? "Manage Link" : "Link Variant"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : debouncedVariantSearch.trim() ? (
            <p className="muted-text">No variants matched this search.</p>
          ) : null}

          <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
            This v1 stores supplier product code, supplier cost, preferred supplier flag, and active state only. It does not ingest supplier catalogues or external feeds.
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Linked Supplier Items</h2>
              <p className="muted-text">
                Existing supplier-product links available to current purchasing flows.
              </p>
            </div>
            <span className="table-secondary">Preferred links: {summary.preferredLinkCount}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Product</th>
                  <th>Variant / SKU</th>
                  <th>Supplier Ref</th>
                  <th>Supplier Cost</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {linkedRows.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No supplier links have been recorded yet.</td>
                  </tr>
                ) : linkedRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.supplierName}</td>
                    <td>{row.productName}</td>
                    <td>
                      <div>{row.variantName || row.variantOption || "Unnamed variant"}</div>
                      <div className="table-secondary mono-text">{row.sku}</div>
                    </td>
                    <td>{row.supplierProductCode || "-"}</td>
                    <td>{formatMoney(row.supplierCostPence)}</td>
                    <td>
                      <div>{row.isActive ? "Active" : "Inactive"}</div>
                      <div className="table-secondary">{row.preferredSupplier ? "Preferred supplier" : "Standard link"}</div>
                    </td>
                    <td>{formatDate(row.updatedAt)}</td>
                    <td>
                      <button type="button" onClick={() => startEditingLink(row)}>
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Intake Attention</h2>
            <Link to="/purchasing">Open purchasing</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Product</th>
                  <th>Variant / SKU</th>
                  <th>Ordered</th>
                  <th>Received</th>
                  <th>Latest PO</th>
                  <th>Expected</th>
                  <th>Attention</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {attentionRows.length === 0 ? (
                  <tr>
                    <td colSpan={9}>No supplier catalogue intake issues found.</td>
                  </tr>
                ) : attentionRows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <div className="table-primary">{row.supplierName}</div>
                      <div className="table-secondary"><Link to="/suppliers">Suppliers workspace</Link></div>
                    </td>
                    <td>{row.productName}</td>
                    <td>
                      <div>{row.variantName || "Unnamed variant"}</div>
                      <div className="table-secondary mono-text">{row.sku}</div>
                    </td>
                    <td>{row.totalOrdered}</td>
                    <td>{row.totalReceived}</td>
                    <td><Link to={`/purchasing/${row.latestPurchaseOrderId}`}>{row.latestPurchaseOrderId.slice(0, 8)}</Link></td>
                    <td>{formatDate(row.latestExpectedAt)}</td>
                    <td>
                      {!row.supplierLink ? <div>Missing supplier link</div> : null}
                      {row.hasMissingCost ? <div>Missing PO unit cost</div> : null}
                      {row.totalReceived < row.totalOrdered ? <div>Still awaiting stock</div> : null}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setLinkSupplierId(row.supplierId);
                          selectVariantForLink(
                            {
                              id: row.variantId,
                              productId: row.productId,
                              productName: row.productName,
                              variantName: row.variantName,
                              variantOption: null,
                              sku: row.sku,
                              barcode: null,
                              costPricePence: row.supplierLink?.variantCostPricePence ?? null,
                            },
                            row.supplierLink,
                          );
                        }}
                      >
                        {row.supplierLink ? "Review Link" : "Create Link"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Frequently Ordered Supplier Items</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Product</th>
                  <th>Variant / SKU</th>
                  <th>Orders</th>
                  <th>Total Ordered</th>
                  <th>Total Received</th>
                  <th>Supplier Link</th>
                  <th>Latest Activity</th>
                </tr>
              </thead>
              <tbody>
                {topRows.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No supplier purchasing history found.</td>
                  </tr>
                ) : topRows.map((row) => (
                  <tr key={`${row.key}-top`}>
                    <td>{row.supplierName}</td>
                    <td>{row.productName}</td>
                    <td>
                      <div>{row.variantName || "Unnamed variant"}</div>
                      <div className="table-secondary mono-text">{row.sku}</div>
                    </td>
                    <td>{row.orderCount}</td>
                    <td>{row.totalOrdered}</td>
                    <td>{row.totalReceived}</td>
                    <td>
                      {row.supplierLink ? (
                        <>
                          <div>{row.supplierLink.supplierProductCode || "No supplier code"}</div>
                          <div className="table-secondary">{formatMoney(row.supplierLink.supplierCostPence)}</div>
                        </>
                      ) : (
                        <span className="table-secondary">Missing link</span>
                      )}
                    </td>
                    <td>{formatDate(row.latestCreatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
