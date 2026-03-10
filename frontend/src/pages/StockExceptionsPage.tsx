import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { reorderUrgencyRank, toReorderSuggestionRow } from "../utils/reordering";

type VelocityRow = {
  productId: string;
  productName: string;
  currentOnHand: number;
  quantitySold: number;
  velocityPer30Days: number;
  lastSoldAt: string | null;
};

type VelocityResponse = {
  filters: {
    from: string;
    to: string;
    rangeDays: number;
  };
  products: VelocityRow[];
};

type PurchaseOrder = {
  id: string;
  status: "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  expectedAt: string | null;
  supplier: {
    name: string;
  };
  totals: {
    quantityRemaining: number;
  };
};

type PurchaseOrderListResponse = {
  purchaseOrders: PurchaseOrder[];
};

type RangePreset = "30" | "90";

const formatDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const daysOverdue = (expectedAt: string | null) => {
  if (!expectedAt) {
    return null;
  }
  const diffMs = Date.now() - new Date(expectedAt).getTime();
  return diffMs > 0 ? Math.floor(diffMs / 86_400_000) : null;
};

export const StockExceptionsPage = () => {
  const { error } = useToasts();
  const [rangePreset, setRangePreset] = useState<RangePreset>("30");
  const [velocity, setVelocity] = useState<VelocityResponse | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    const today = new Date();
    const to = formatDateKey(today);
    const from = formatDateKey(shiftDays(today, -(Number(rangePreset) - 1)));

    const [velocityResult, poResult] = await Promise.allSettled([
      apiGet<VelocityResponse>(`/api/reports/inventory/velocity?from=${from}&to=${to}&take=200`),
      apiGet<PurchaseOrderListResponse>("/api/purchase-orders?take=200&skip=0"),
    ]);

    if (velocityResult.status === "fulfilled") {
      setVelocity(velocityResult.value);
    } else {
      setVelocity(null);
      error(velocityResult.reason instanceof Error ? velocityResult.reason.message : "Failed to load stock exception signals");
    }

    if (poResult.status === "fulfilled") {
      setPurchaseOrders(poResult.value.purchaseOrders || []);
    } else {
      setPurchaseOrders([]);
      error(poResult.reason instanceof Error ? poResult.reason.message : "Failed to load purchasing exception signals");
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  const reorderSuggestions = useMemo(() => {
    if (!velocity) {
      return [];
    }
    return velocity.products
      .map((row) => toReorderSuggestionRow(row, velocity.filters.rangeDays))
      .sort((left, right) => (
        reorderUrgencyRank[right.urgency] - reorderUrgencyRank[left.urgency]
        || left.currentOnHand - right.currentOnHand
        || right.quantitySold - left.quantitySold
      ));
  }, [velocity]);

  const negativeStock = useMemo(
    () => reorderSuggestions.filter((row) => row.currentOnHand < 0),
    [reorderSuggestions],
  );

  const zeroStockWithSales = useMemo(
    () => reorderSuggestions.filter((row) => row.currentOnHand === 0 && row.quantitySold > 0),
    [reorderSuggestions],
  );

  const lowStockPressure = useMemo(
    () => reorderSuggestions.filter((row) => row.urgency !== "Low" || row.currentOnHand <= 2).slice(0, 25),
    [reorderSuggestions],
  );

  const poLinkedAttention = useMemo(
    () => purchaseOrders
      .filter((po) => po.status !== "RECEIVED" && po.status !== "CANCELLED")
      .filter((po) => po.totals.quantityRemaining > 0)
      .filter((po) => po.status === "PARTIALLY_RECEIVED" || (daysOverdue(po.expectedAt) ?? -1) >= 0)
      .sort((left, right) => (daysOverdue(right.expectedAt) ?? 0) - (daysOverdue(left.expectedAt) ?? 0)),
    [purchaseOrders],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Stock Exceptions</h1>
            <p className="muted-text">
              Manager-facing investigation queue for unusual stock states already visible in current inventory and purchasing data. This page uses honest exception buckets only.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Range
              <select value={rangePreset} onChange={(event) => setRangePreset(event.target.value as RangePreset)}>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </label>
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadReport()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Negative Stock</span>
            <strong className="metric-value">{negativeStock.length}</strong>
            <span className="dashboard-metric-detail">Products below zero on-hand</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Zero Stock With Sales</span>
            <strong className="metric-value">{zeroStockWithSales.length}</strong>
            <span className="dashboard-metric-detail">Sold in range but currently zero</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Reorder Pressure</span>
            <strong className="metric-value">{lowStockPressure.length}</strong>
            <span className="dashboard-metric-detail">Low-stock items with current demand signals</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">PO-linked Attention</span>
            <strong className="metric-value">{poLinkedAttention.length}</strong>
            <span className="dashboard-metric-detail">Under-received or overdue open purchase orders</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Negative Stock</h2>
            <Link to="/management/inventory">Inventory intel</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>On Hand</th>
                  <th>Sold</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {negativeStock.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No negative stock exceptions.</td>
                  </tr>
                ) : negativeStock.map((row) => (
                  <tr key={row.productId}>
                    <td>{row.productName}</td>
                    <td>{row.currentOnHand}</td>
                    <td>{row.quantitySold}</td>
                    <td><Link to="/inventory">Open inventory</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Zero Stock With Recent Sales</h2>
            <Link to="/management/reordering">Reordering</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Sold</th>
                  <th>Velocity / 30d</th>
                  <th>Urgency</th>
                </tr>
              </thead>
              <tbody>
                {zeroStockWithSales.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No zero-stock recent-sales exceptions.</td>
                  </tr>
                ) : zeroStockWithSales.map((row) => (
                  <tr key={row.productId}>
                    <td>{row.productName}</td>
                    <td>{row.quantitySold}</td>
                    <td>{row.velocityPer30Days.toFixed(1)}</td>
                    <td>{row.urgency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Low Stock With Reorder Pressure</h2>
            <Link to="/management/reordering">Open reordering</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>On Hand</th>
                  <th>Suggested Qty</th>
                  <th>Days Cover</th>
                  <th>Urgency</th>
                </tr>
              </thead>
              <tbody>
                {lowStockPressure.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No current low-stock pressure items.</td>
                  </tr>
                ) : lowStockPressure.map((row) => (
                  <tr key={row.productId}>
                    <td>{row.productName}</td>
                    <td>{row.currentOnHand}</td>
                    <td>{row.suggestedReorderQty}</td>
                    <td>{row.daysOfCover === null ? "-" : row.daysOfCover.toFixed(1)}</td>
                    <td>{row.urgency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>PO-linked Attention</h2>
            <Link to="/management/purchasing">PO action centre</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Purchase Order</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Remaining Qty</th>
                  <th>Exception</th>
                </tr>
              </thead>
              <tbody>
                {poLinkedAttention.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No PO-linked stock exceptions.</td>
                  </tr>
                ) : poLinkedAttention.map((po) => {
                  const overdue = daysOverdue(po.expectedAt);
                  const signal = po.status === "PARTIALLY_RECEIVED"
                    ? "Partially received with outstanding quantity"
                    : overdue !== null && overdue >= 0
                      ? `Overdue by ${overdue + 1} day${overdue === 0 ? "" : "s"}`
                      : "Open purchase order";
                  return (
                    <tr key={po.id}>
                      <td><Link to={`/purchasing/${po.id}`}>{po.id.slice(0, 8)}</Link></td>
                      <td>{po.supplier.name}</td>
                      <td>{po.status}</td>
                      <td>{po.totals.quantityRemaining}</td>
                      <td>{signal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
