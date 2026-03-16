import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "../components/ToastProvider";

type WarrantyStatus = "OPEN" | "FOLLOW_UP" | "RETURNED" | "RESOLVED";

type WarrantyItem = {
  workshopJobId: string;
  rawStatus: string;
  customerId: string | null;
  customerName: string;
  bikeDescription: string | null;
  sale: { id: string; totalPence: number } | null;
  warrantyStatus: WarrantyStatus;
  latestWarrantyNote: string;
  latestWarrantyNoteAt: string;
};

type WarrantyReportResponse = {
  items: WarrantyItem[];
};

type PurchaseOrder = {
  id: string;
  status: "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  expectedAt: string | null;
  supplier: { name: string };
  totals: { quantityRemaining: number };
};

type PurchaseOrderListResponse = {
  purchaseOrders: PurchaseOrder[];
};

type QueueReason = "WARRANTY_RETURN" | "WARRANTY_FOLLOW_UP" | "RECEIVING_PROBLEM";

type QueueItem = {
  key: string;
  reason: QueueReason;
  title: string;
  detail: string;
  link: string;
  secondaryLink?: string;
};

const reviewedKeyFor = (username: string | undefined) => `corepos.supplierReturns.reviewed.${username || "unknown"}`;

const daysOverdue = (value: string | null) => {
  if (!value) {
    return null;
  }
  const diffMs = Date.now() - new Date(value).getTime();
  return diffMs > 0 ? Math.floor(diffMs / 86_400_000) : null;
};

export const SupplierReturnsPage = () => {
  const { user } = useAuth();
  const { error } = useToasts();
  const [warrantyItems, setWarrantyItems] = useState<WarrantyItem[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [hideReviewed, setHideReviewed] = useState(true);
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(reviewedKeyFor(user?.username));
      setReviewed(stored ? JSON.parse(stored) : {});
    } catch {
      setReviewed({});
    }
  }, [user?.username]);

  const persistReviewed = (next: Record<string, boolean>) => {
    setReviewed(next);
    localStorage.setItem(reviewedKeyFor(user?.username), JSON.stringify(next));
  };

  const loadQueue = async () => {
    setLoading(true);
    const [warrantyResult, poResult] = await Promise.allSettled([
      apiGet<WarrantyReportResponse>("/api/reports/workshop/warranty?take=100"),
      apiGet<PurchaseOrderListResponse>("/api/purchase-orders?take=200&skip=0"),
    ]);

    if (warrantyResult.status === "fulfilled") {
      setWarrantyItems(warrantyResult.value.items || []);
    } else {
      setWarrantyItems([]);
      error(warrantyResult.reason instanceof Error ? warrantyResult.reason.message : "Failed to load warranty queue");
    }

    if (poResult.status === "fulfilled") {
      setPurchaseOrders(poResult.value.purchaseOrders || []);
    } else {
      setPurchaseOrders([]);
      error(poResult.reason instanceof Error ? poResult.reason.message : "Failed to load receiving issues");
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo<QueueItem[]>(() => {
    const next: QueueItem[] = [];

    for (const item of warrantyItems) {
      if (item.warrantyStatus === "RETURNED") {
        next.push({
          key: `warranty-return-${item.workshopJobId}`,
          reason: "WARRANTY_RETURN",
          title: item.customerName,
          detail: item.bikeDescription || item.latestWarrantyNote || "Warranty return candidate",
          link: `/workshop/${item.workshopJobId}`,
          secondaryLink: item.customerId ? `/customers/${item.customerId}` : undefined,
        });
      }
      if (item.warrantyStatus === "FOLLOW_UP" || item.warrantyStatus === "OPEN") {
        next.push({
          key: `warranty-followup-${item.workshopJobId}`,
          reason: "WARRANTY_FOLLOW_UP",
          title: item.customerName,
          detail: item.latestWarrantyNote || item.rawStatus,
          link: `/management/warranty`,
          secondaryLink: `/workshop/${item.workshopJobId}`,
        });
      }
    }

    for (const po of purchaseOrders) {
      const overdue = daysOverdue(po.expectedAt);
      if (
        po.status !== "RECEIVED"
        && po.status !== "CANCELLED"
        && po.totals.quantityRemaining > 0
        && (po.status === "PARTIALLY_RECEIVED" || (overdue ?? -1) >= 0)
      ) {
        next.push({
          key: `receiving-problem-${po.id}`,
          reason: "RECEIVING_PROBLEM",
          title: po.supplier.name,
          detail: `${po.status.replaceAll("_", " ")} | ${po.totals.quantityRemaining} qty remaining${overdue !== null && overdue >= 0 ? ` | ${overdue} days overdue` : ""}`,
          link: `/purchasing/${po.id}`,
          secondaryLink: "/purchasing/receiving",
        });
      }
    }

    return next.filter((item) => (hideReviewed ? !reviewed[item.key] : true));
  }, [hideReviewed, purchaseOrders, reviewed, warrantyItems]);

  const grouped = useMemo(() => ({
    returns: items.filter((item) => item.reason === "WARRANTY_RETURN"),
    followUp: items.filter((item) => item.reason === "WARRANTY_FOLLOW_UP"),
    receiving: items.filter((item) => item.reason === "RECEIVING_PROBLEM"),
  }), [items]);

  const markReviewed = (key: string) => {
    persistReviewed({ ...reviewed, [key]: true });
  };

  const renderRows = (rows: QueueItem[], emptyLabel: string) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Reason</th>
            <th>Context</th>
            <th>Detail</th>
            <th>Links</th>
            <th>Review</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5}>{emptyLabel}</td>
            </tr>
          ) : rows.map((row) => (
            <tr key={row.key}>
              <td>{row.reason.replaceAll("_", " ")}</td>
              <td>{row.title}</td>
              <td>{row.detail}</td>
              <td>
                <div className="actions-inline">
                  <Link to={row.link}>Open</Link>
                  {row.secondaryLink ? <Link to={row.secondaryLink}>Related</Link> : null}
                </div>
              </td>
              <td>
                <button type="button" onClick={() => markReviewed(row.key)}>Mark reviewed</button>
              </td>
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
            <h1>Supplier Returns</h1>
            <p className="muted-text">
              Internal supplier-facing returns and send-back queue built from current warranty tracking and receiving problems. This is a visibility tool, not a full supplier RMA engine.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Reviewed
              <select value={hideReviewed ? "hide" : "show"} onChange={(event) => setHideReviewed(event.target.value === "hide")}>
                <option value="hide">Hide reviewed</option>
                <option value="show">Show reviewed</option>
              </select>
            </label>
            <button type="button" onClick={() => void loadQueue()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Warranty Returns</span>
            <strong className="metric-value">{grouped.returns.length}</strong>
            <span className="dashboard-metric-detail">Jobs already tagged as returned</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Warranty Follow-up</span>
            <strong className="metric-value">{grouped.followUp.length}</strong>
            <span className="dashboard-metric-detail">Open or follow-up warranty work</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Receiving Problems</span>
            <strong className="metric-value">{grouped.receiving.length}</strong>
            <span className="dashboard-metric-detail">Open PO issues likely needing supplier attention</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Warranty Return Candidates</h2>
            <Link to="/management/warranty">Warranty tracking</Link>
          </div>
          {renderRows(grouped.returns, "No warranty return candidates are visible.")}
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Warranty Follow-up</h2>
            <Link to="/management/warranty">Open warranty queue</Link>
          </div>
          {renderRows(grouped.followUp, "No warranty follow-up items are visible.")}
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Receiving Problems</h2>
            <Link to="/purchasing/receiving">Receiving workspace</Link>
          </div>
          {renderRows(grouped.receiving, "No supplier receiving problems are currently visible.")}
          <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
            Supplier linkage is only shown where the current branch already models it cleanly through purchase orders or warranty-tagged workshop work.
          </div>
        </section>
      </div>
    </div>
  );
};
