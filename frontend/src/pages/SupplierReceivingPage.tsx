import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type PurchaseOrder = {
  id: string;
  status: "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  createdAt: string;
  expectedAt: string | null;
  updatedAt: string;
  supplier: {
    id: string;
    name: string;
  };
  totals: {
    quantityOrdered: number;
    quantityReceived: number;
    quantityRemaining: number;
  };
};

type PurchaseOrderListResponse = {
  purchaseOrders: PurchaseOrder[];
};

const daysUntil = (value: string | null) => {
  if (!value) {
    return null;
  }

  const ms = new Date(value).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
};

const formatExpected = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "-");

const formatPurchaseOrderStatus = (status: PurchaseOrder["status"]) => {
  switch (status) {
    case "PARTIALLY_RECEIVED":
      return "Partially Received";
    case "SENT":
      return "Ordered";
    default:
      return status.charAt(0) + status.slice(1).toLowerCase();
  }
};

const getReceivingNextStep = (purchaseOrder: PurchaseOrder) => {
  if (purchaseOrder.status === "PARTIALLY_RECEIVED") {
    return "Book in the remaining delivery on the same PO and confirm any final unit-cost changes.";
  }

  const delta = daysUntil(purchaseOrder.expectedAt);
  if (delta !== null && delta < 0) {
    return "Delivery is overdue. Chase the supplier, then receive only what has actually arrived.";
  }

  return "Open the PO when the delivery lands and post the received quantity into stock.";
};

const statusBadgeClass = (status: PurchaseOrder["status"]) => {
  switch (status) {
    case "RECEIVED":
      return "status-badge status-complete";
    case "PARTIALLY_RECEIVED":
      return "status-badge status-warning";
    case "CANCELLED":
      return "status-badge status-cancelled";
    case "SENT":
      return "status-badge status-info";
    default:
      return "status-badge";
  }
};

export const SupplierReceivingPage = () => {
  const { error } = useToasts();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const loadPurchaseOrders = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<PurchaseOrderListResponse>("/api/purchase-orders?take=200&skip=0");
      setPurchaseOrders(payload.purchaseOrders || []);
    } catch (loadError) {
      setPurchaseOrders([]);
      error(loadError instanceof Error ? loadError.message : "Failed to load receiving workspace");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPurchaseOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return purchaseOrders;
    }

    return purchaseOrders.filter((po) =>
      [po.id, po.status, po.supplier.name].join(" ").toLowerCase().includes(needle),
    );
  }, [purchaseOrders, search]);

  const readyToReceive = useMemo(
    () => filtered.filter((po) => po.status === "SENT" && po.totals.quantityRemaining > 0),
    [filtered],
  );

  const partiallyReceived = useMemo(
    () => filtered.filter((po) => po.status === "PARTIALLY_RECEIVED" && po.totals.quantityRemaining > 0),
    [filtered],
  );

  const overdue = useMemo(
    () => filtered
      .filter((po) => (po.status === "SENT" || po.status === "PARTIALLY_RECEIVED") && po.totals.quantityRemaining > 0)
      .filter((po) => {
        const delta = daysUntil(po.expectedAt);
        return delta !== null && delta < 0;
      })
      .sort((left, right) => (daysUntil(left.expectedAt) ?? 0) - (daysUntil(right.expectedAt) ?? 0)),
    [filtered],
  );

  const renderTable = (rows: PurchaseOrder[], emptyLabel: string) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>PO</th>
            <th>Supplier</th>
            <th>Status</th>
            <th>Expected</th>
            <th>Ordered</th>
            <th>Received</th>
            <th>Remaining</th>
            <th>Next Step</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={9}>{emptyLabel}</td>
            </tr>
          ) : rows.map((po) => (
            <tr key={po.id}>
              <td>
                <div className="table-primary mono-text">{po.id.slice(0, 8)}</div>
                <div className="table-secondary">Created {new Date(po.createdAt).toLocaleDateString()}</div>
              </td>
              <td>{po.supplier.name}</td>
              <td><span className={statusBadgeClass(po.status)}>{formatPurchaseOrderStatus(po.status)}</span></td>
              <td>{formatExpected(po.expectedAt)}</td>
              <td>{po.totals.quantityOrdered}</td>
              <td>{po.totals.quantityReceived}</td>
              <td>{po.totals.quantityRemaining}</td>
              <td>
                <div className="table-primary">{getReceivingNextStep(po)}</div>
                <div className="table-secondary">
                  {po.expectedAt ? `Expected ${formatExpected(po.expectedAt)}` : "No expected date recorded"}
                </div>
              </td>
              <td><Link to={`/purchasing/${po.id}`}>Open PO</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Supplier Receiving</h1>
            <p className="muted-text">
              Receiving-focused workspace built on the existing purchase order list and receiving flow. Use this to triage deliveries before drilling into PO detail. Ordered means no stock has been booked in yet; Partially Received means the PO is still live until the remaining delivery lands.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/purchasing">Purchasing</Link>
            <button type="button" onClick={() => void loadPurchaseOrders()} disabled={loading}>
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
              placeholder="PO id, status, or supplier"
            />
          </label>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Ready to Receive</span>
            <strong className="metric-value">{readyToReceive.length}</strong>
            <span className="dashboard-metric-detail">Sent POs with stock still outstanding</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Partially Received</span>
            <strong className="metric-value">{partiallyReceived.length}</strong>
            <span className="dashboard-metric-detail">Receiving still in progress</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Overdue Awaiting Delivery</span>
            <strong className="metric-value">{overdue.length}</strong>
            <span className="dashboard-metric-detail">Expected date has passed with quantity remaining</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Outstanding Units</span>
            <strong className="metric-value">
              {filtered.reduce((sum, po) => sum + po.totals.quantityRemaining, 0)}
            </strong>
            <span className="dashboard-metric-detail">Across the currently visible receiving queue</span>
          </div>
        </div>

        <p className="muted-text">
          Use Ready to Receive when a full delivery arrives, Partially Received when you are waiting on the balance of a supplier shipment, and Overdue Awaiting Delivery when someone needs chasing.
        </p>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Ready to Receive</h2>
            <Link to="/purchasing">All purchase orders</Link>
          </div>
          {renderTable(readyToReceive, "No sent purchase orders currently look ready to receive.")}
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Partially Received</h2>
            <Link to="/purchasing">Receiving detail</Link>
          </div>
          {renderTable(partiallyReceived, "No partially received purchase orders are awaiting more stock.")}
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Overdue Awaiting Delivery</h2>
            <Link to="/suppliers">Suppliers</Link>
          </div>
          {renderTable(overdue, "No overdue purchase orders are currently waiting for delivery.")}
        </section>
      </div>
    </div>
  );
};
