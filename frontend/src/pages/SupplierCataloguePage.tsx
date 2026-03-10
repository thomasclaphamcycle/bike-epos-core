import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
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
};

const formatMoney = (pence: number | null) => (pence === null ? "-" : `£${(pence / 100).toFixed(2)}`);
const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "-");

export const SupplierCataloguePage = () => {
  const { error } = useToasts();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [supplierPayload, poPayload] = await Promise.all([
        apiGet<SupplierListResponse>("/api/suppliers"),
        apiGet<PurchaseOrderListResponse>("/api/purchase-orders?take=200&skip=0"),
      ]);
      setSuppliers(supplierPayload.suppliers || []);
      setPurchaseOrders(poPayload.purchaseOrders || []);
    } catch (loadError) {
      setSuppliers([]);
      setPurchaseOrders([]);
      error(loadError instanceof Error ? loadError.message : "Failed to load supplier catalogue intake data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const intakeRows = useMemo(() => {
    const map = new Map<string, IntakeRow>();

    for (const purchaseOrder of purchaseOrders) {
      for (const item of purchaseOrder.items) {
        const key = `${purchaseOrder.supplierId}:${item.variantId}`;
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
      .filter((row) => {
        if (!needle) {
          return true;
        }
        const haystack = [row.supplierName, row.productName, row.variantName ?? "", row.sku].join(" ").toLowerCase();
        return haystack.includes(needle);
      })
      .sort((left, right) => (
        Number(right.hasMissingCost) - Number(left.hasMissingCost)
        || right.orderCount - left.orderCount
        || right.totalOrdered - left.totalOrdered
        || left.supplierName.localeCompare(right.supplierName)
        || left.productName.localeCompare(right.productName)
      ));
  }, [debouncedSearch, purchaseOrders]);

  const attentionRows = intakeRows.filter((row) => row.hasMissingCost || row.totalReceived < row.totalOrdered).slice(0, 25);
  const topRows = intakeRows.slice(0, 25);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Supplier Catalogue / Intake</h1>
            <p className="muted-text">
              Manager-facing intake aid built from existing suppliers and purchase order history. This helps identify frequently ordered items and catalogue/admin gaps without inventing a supplier integration platform.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management">Back to management</Link>
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
              placeholder="Supplier, product, variant, SKU"
            />
          </label>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Suppliers</span>
            <strong className="metric-value">{suppliers.length}</strong>
            <span className="dashboard-metric-detail">Suppliers visible to purchasing</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Tracked Intake Rows</span>
            <strong className="metric-value">{intakeRows.length}</strong>
            <span className="dashboard-metric-detail">Supplier + variant purchase history rows</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Needs Attention</span>
            <strong className="metric-value">{attentionRows.length}</strong>
            <span className="dashboard-metric-detail">Missing cost or still under-received</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Open Purchase Orders</span>
            <strong className="metric-value">{purchaseOrders.filter((po) => po.status !== "RECEIVED" && po.status !== "CANCELLED").length}</strong>
            <span className="dashboard-metric-detail">Potential intake follow-up items</span>
          </div>
        </div>
      </section>

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
                </tr>
              </thead>
              <tbody>
                {attentionRows.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No supplier catalogue intake issues found.</td>
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
                      {row.hasMissingCost ? <div>Missing unit cost</div> : null}
                      {row.totalReceived < row.totalOrdered ? <div>Still awaiting stock</div> : null}
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
                  <th>Latest Activity</th>
                </tr>
              </thead>
              <tbody>
                {topRows.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No supplier purchasing history found.</td>
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
                    <td>{formatDate(row.latestCreatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
            This v1 uses existing supplier and purchase order history only. It does not ingest supplier catalogues or external feeds.
          </div>
        </section>
      </div>
    </div>
  );
};
