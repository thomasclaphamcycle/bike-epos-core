import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { SavedViewControls } from "../components/SavedViewControls";
import { useToasts } from "../components/ToastProvider";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

type Supplier = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

type PurchaseOrder = {
  id: string;
  supplierId: string;
  supplier: Supplier;
  status: "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  orderedAt: string | null;
  expectedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  totals: {
    quantityOrdered: number;
    quantityReceived: number;
    quantityRemaining: number;
  };
};

type PurchaseOrderListResponse = {
  purchaseOrders: PurchaseOrder[];
};

const OPEN_STATUSES = new Set(["DRAFT", "SENT", "PARTIALLY_RECEIVED"]);

const formatDateTime = (value: string | null) => (value ? new Date(value).toLocaleString() : "-");

const daysOverdue = (expectedAt: string | null) => {
  if (!expectedAt) {
    return null;
  }
  const diffMs = Date.now() - new Date(expectedAt).getTime();
  return diffMs > 0 ? Math.floor(diffMs / 86_400_000) : null;
};

const getPriorityScore = (po: PurchaseOrder) => {
  const overdue = daysOverdue(po.expectedAt);
  if (overdue !== null && overdue >= 0) {
    return 3000 + overdue;
  }
  if (po.status === "PARTIALLY_RECEIVED") {
    return 2000;
  }
  if (po.status === "DRAFT") {
    return 1000;
  }
  return 0;
};

export const PurchaseOrderActionPage = () => {
  const { error } = useToasts();

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);

  const applySavedFilters = (filters: Record<string, string>) => {
    setSearch(filters.search ?? "");
  };

  const loadPurchaseOrders = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<PurchaseOrderListResponse>("/api/purchase-orders?take=200&skip=0");
      setPurchaseOrders(payload.purchaseOrders || []);
    } catch (loadError) {
      setPurchaseOrders([]);
      error(loadError instanceof Error ? loadError.message : "Failed to load purchase orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPurchaseOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredPurchaseOrders = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    if (!needle) {
      return purchaseOrders;
    }

    return purchaseOrders.filter((po) => {
      const haystack = [
        po.id,
        po.supplier.name,
        po.supplier.email ?? "",
        po.supplier.phone ?? "",
        po.status,
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [debouncedSearch, purchaseOrders]);

  const openPurchaseOrders = useMemo(
    () => filteredPurchaseOrders.filter((po) => OPEN_STATUSES.has(po.status)),
    [filteredPurchaseOrders],
  );

  const overduePurchaseOrders = useMemo(
    () => openPurchaseOrders
      .filter((po) => {
        const overdue = daysOverdue(po.expectedAt);
        return overdue !== null && overdue >= 0;
      })
      .sort((left, right) => (daysOverdue(right.expectedAt) ?? 0) - (daysOverdue(left.expectedAt) ?? 0)),
    [openPurchaseOrders],
  );

  const partiallyReceived = useMemo(
    () => openPurchaseOrders
      .filter((po) => po.status === "PARTIALLY_RECEIVED")
      .sort((left, right) => right.totals.quantityRemaining - left.totals.quantityRemaining),
    [openPurchaseOrders],
  );

  const actionQueue = useMemo(
    () => [...openPurchaseOrders].sort((left, right) => (
      getPriorityScore(right) - getPriorityScore(left)
      || new Date(left.expectedAt ?? left.createdAt).getTime() - new Date(right.expectedAt ?? right.createdAt).getTime()
    )),
    [openPurchaseOrders],
  );

  const draftCount = useMemo(
    () => openPurchaseOrders.filter((po) => po.status === "DRAFT").length,
    [openPurchaseOrders],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Purchase Order Action Centre</h1>
            <p className="muted-text">
              Manager-facing purchasing queue showing which open purchase orders need attention first. This complements the detailed purchasing UI instead of replacing it.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management">Back to management</Link>
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
              placeholder="PO id, supplier, status"
            />
          </label>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Open Purchase Orders</span>
            <strong className="metric-value">{openPurchaseOrders.length}</strong>
            <span className="dashboard-metric-detail">Draft, sent, or partially received</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Overdue Open POs</span>
            <strong className="metric-value">{overduePurchaseOrders.length}</strong>
            <span className="dashboard-metric-detail">Expected date has passed</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Partially Received</span>
            <strong className="metric-value">{partiallyReceived.length}</strong>
            <span className="dashboard-metric-detail">Still awaiting stock</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Drafts To Send</span>
            <strong className="metric-value">{draftCount}</strong>
            <span className="dashboard-metric-detail">Still in draft status</span>
          </div>
        </div>
      </section>

      <SavedViewControls
        pageKey="purchasing"
        currentFilters={{ search }}
        onApplyFilters={applySavedFilters}
        defaultName={search.trim() ? `POs ${search.trim()}` : "Open PO queue"}
      />

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Priority Queue</h2>
            <Link to="/purchasing">Open purchasing workspace</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Purchase Order</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Expected</th>
                  <th>Remaining Qty</th>
                  <th>Action Signal</th>
                </tr>
              </thead>
              <tbody>
                {actionQueue.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No open purchase orders need action.</td>
                  </tr>
                ) : (
                  actionQueue.map((po) => {
                    const overdue = daysOverdue(po.expectedAt);
                    const actionSignal = overdue !== null && overdue >= 0
                      ? `Overdue by ${overdue + 1} day${overdue === 0 ? "" : "s"}`
                      : po.status === "PARTIALLY_RECEIVED"
                        ? "Partially received"
                        : po.status === "DRAFT"
                          ? "Ready to send"
                          : "Open order";

                    return (
                      <tr key={po.id}>
                        <td><Link to={`/purchasing/${po.id}`}>{po.id.slice(0, 8)}</Link></td>
                        <td>{po.supplier.name}</td>
                        <td>{po.status}</td>
                        <td>{formatDateTime(po.expectedAt)}</td>
                        <td>{po.totals.quantityRemaining}</td>
                        <td>{actionSignal}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Overdue Purchase Orders</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Purchase Order</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Expected</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {overduePurchaseOrders.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No overdue open purchase orders.</td>
                  </tr>
                ) : (
                  overduePurchaseOrders.map((po) => (
                    <tr key={po.id}>
                      <td><Link to={`/purchasing/${po.id}`}>{po.id.slice(0, 8)}</Link></td>
                      <td>{po.supplier.name}</td>
                      <td>{po.status}</td>
                      <td>{formatDateTime(po.expectedAt)}</td>
                      <td>{formatDateTime(po.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Partially Received</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Purchase Order</th>
                  <th>Supplier</th>
                  <th>Ordered</th>
                  <th>Received</th>
                  <th>Remaining</th>
                  <th>Expected</th>
                </tr>
              </thead>
              <tbody>
                {partiallyReceived.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No partially received purchase orders.</td>
                  </tr>
                ) : (
                  partiallyReceived.map((po) => (
                    <tr key={po.id}>
                      <td><Link to={`/purchasing/${po.id}`}>{po.id.slice(0, 8)}</Link></td>
                      <td>{po.supplier.name}</td>
                      <td>{po.totals.quantityOrdered}</td>
                      <td>{po.totals.quantityReceived}</td>
                      <td>{po.totals.quantityRemaining}</td>
                      <td>{formatDateTime(po.expectedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
