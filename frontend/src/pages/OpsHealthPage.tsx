import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "../components/ToastProvider";
import { toReorderSuggestionRow } from "../utils/reordering";
import {
  isWorkshopAwaitingApproval,
  isWorkshopWaitingForParts,
} from "../utils/workshopStatus";

type CashSession = { id: string; status: "OPEN" | "CLOSED" };
type CashSessionListResponse = { sessions: CashSession[] };

type PurchaseOrder = {
  id: string;
  status: "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  expectedAt: string | null;
  totals: { quantityRemaining: number };
};

type PurchaseOrderListResponse = { purchaseOrders: PurchaseOrder[] };

type WorkshopDashboardResponse = {
  jobs: Array<{
    id: string;
    status: string;
    executionStatus?: string | null;
    currentEstimateStatus?: string | null;
    partsStatus?: "OK" | "UNALLOCATED" | "SHORT";
  }>;
};

type VelocityRow = {
  productId: string;
  productName: string;
  currentOnHand: number;
  quantitySold: number;
  velocityPer30Days: number;
};

type VelocityResponse = {
  filters: { rangeDays: number };
  products: VelocityRow[];
};

type VariantRow = {
  id: string;
  retailPricePence: number;
  costPricePence: number | null;
  barcode: string | null;
};

type VariantListResponse = { variants: VariantRow[] };

type AuditEvent = {
  id: string;
  action: string;
  actorRole: string | null;
  createdAt: string;
};

type AuditResponse = { events: AuditEvent[] };

const isAdmin = (role: string | undefined) => role === "ADMIN";

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

export const OpsHealthPage = () => {
  const { user } = useAuth();
  const { error } = useToasts();
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [workshop, setWorkshop] = useState<WorkshopDashboardResponse | null>(null);
  const [velocity, setVelocity] = useState<VelocityResponse | null>(null);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const loadHealth = async () => {
    setLoading(true);
    const today = new Date();
    const to = formatDateKey(today);
    const from = formatDateKey(shiftDays(today, -29));

    const [sessionResult, poResult, workshopResult, velocityResult, variantResult, auditResult] = await Promise.allSettled([
      apiGet<CashSessionListResponse>(`/api/till/sessions?from=${from}&to=${to}`),
      apiGet<PurchaseOrderListResponse>("/api/purchase-orders?take=100&skip=0"),
      apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?includeCancelled=false&limit=150"),
      apiGet<VelocityResponse>(`/api/reports/inventory/velocity?from=${from}&to=${to}&take=100`),
      apiGet<VariantListResponse>("/api/variants?take=250&skip=0&active=1"),
      apiGet<AuditResponse>("/api/audit?limit=50"),
    ]);

    if (sessionResult.status === "fulfilled") setSessions(sessionResult.value.sessions || []); else { setSessions([]); error(sessionResult.reason instanceof Error ? sessionResult.reason.message : "Failed to load till readiness"); }
    if (poResult.status === "fulfilled") setPurchaseOrders(poResult.value.purchaseOrders || []); else { setPurchaseOrders([]); error(poResult.reason instanceof Error ? poResult.reason.message : "Failed to load purchasing readiness"); }
    if (workshopResult.status === "fulfilled") setWorkshop(workshopResult.value); else { setWorkshop(null); error(workshopResult.reason instanceof Error ? workshopResult.reason.message : "Failed to load workshop readiness"); }
    if (velocityResult.status === "fulfilled") setVelocity(velocityResult.value); else { setVelocity(null); error(velocityResult.reason instanceof Error ? velocityResult.reason.message : "Failed to load stock readiness"); }
    if (variantResult.status === "fulfilled") setVariants(variantResult.value.variants || []); else { setVariants([]); error(variantResult.reason instanceof Error ? variantResult.reason.message : "Failed to load product data readiness"); }
    if (auditResult.status === "fulfilled") setEvents(auditResult.value.events || []); else { setEvents([]); error(auditResult.reason instanceof Error ? auditResult.reason.message : "Failed to load audit readiness"); }

    setLoading(false);
  };

  useEffect(() => {
    void loadHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTills = useMemo(() => sessions.filter((session) => session.status === "OPEN"), [sessions]);
  const overduePurchaseOrders = useMemo(
    () => purchaseOrders.filter((po) => po.status !== "RECEIVED" && po.status !== "CANCELLED" && po.totals.quantityRemaining > 0 && po.expectedAt && new Date(po.expectedAt).getTime() < Date.now()),
    [purchaseOrders],
  );
  const waitingForParts = useMemo(() => (workshop?.jobs || []).filter(isWorkshopWaitingForParts), [workshop]);
  const waitingForApproval = useMemo(() => (workshop?.jobs || []).filter(isWorkshopAwaitingApproval), [workshop]);
  const stockExceptions = useMemo(() => {
    if (!velocity) return { negative: 0, zeroWithSales: 0, reorderNow: 0 };
    const suggestions = velocity.products.map((row) => toReorderSuggestionRow(row, velocity.filters.rangeDays));
    return {
      negative: suggestions.filter((row) => row.currentOnHand < 0).length,
      zeroWithSales: suggestions.filter((row) => row.currentOnHand === 0 && row.quantitySold > 0).length,
      reorderNow: suggestions.filter((row) => row.urgency === "Reorder Now").length,
    };
  }, [velocity]);
  const dataQuality = useMemo(() => ({
    missingBarcode: variants.filter((variant) => !variant.barcode).length,
    missingCost: variants.filter((variant) => variant.costPricePence === null).length,
    missingPrice: variants.filter((variant) => variant.retailPricePence <= 0).length,
  }), [variants]);
  const criticalActivity = useMemo(
    () => events.filter((event) => ["ADMIN_USER_CREATED", "ADMIN_USER_UPDATED", "ADMIN_USER_PASSWORD_RESET", "PAYMENT_REFUNDED", "WORKSHOP_CANCELLED"].includes(event.action)).slice(0, 12),
    [events],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Ops Health</h1>
            <p className="muted-text">
              Manager/admin operational readiness view built from current till, purchasing, workshop, stock, data-quality, and audit signals. This is a shop-readiness dashboard, not infrastructure monitoring.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadHealth()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Open Tills</span>
            <strong className="metric-value">{openTills.length}</strong>
            <span className="dashboard-metric-detail">Cash handling readiness today</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Overdue POs</span>
            <strong className="metric-value">{overduePurchaseOrders.length}</strong>
            <span className="dashboard-metric-detail">Receiving and supplier attention</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Workshop Blockers</span>
            <strong className="metric-value">{waitingForParts.length + waitingForApproval.length}</strong>
            <span className="dashboard-metric-detail">Approval and parts waiting combined</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Stock Exceptions</span>
            <strong className="metric-value">{stockExceptions.negative + stockExceptions.zeroWithSales + stockExceptions.reorderNow}</strong>
            <span className="dashboard-metric-detail">Negative, zero-with-sales, and reorder-now signals</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Data Quality Attention</span>
            <strong className="metric-value">{dataQuality.missingBarcode + dataQuality.missingCost + dataQuality.missingPrice}</strong>
            <span className="dashboard-metric-detail">Pricing and master-data readiness issues</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Shop Readiness</h2>
            <Link to="/management/summary">Ops summary</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Count</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Open tills</td>
                  <td>{openTills.length}</td>
                  <td><Link to="/management/cash">Cash oversight</Link></td>
                </tr>
                <tr>
                  <td>Overdue purchase orders</td>
                  <td>{overduePurchaseOrders.length}</td>
                  <td><Link to="/purchasing/receiving">Receiving workspace</Link></td>
                </tr>
                <tr>
                  <td>Waiting for approval jobs</td>
                  <td>{waitingForApproval.length}</td>
                  <td><Link to="/management/communications">Communication queue</Link></td>
                </tr>
                <tr>
                  <td>Waiting for parts jobs</td>
                  <td>{waitingForParts.length}</td>
                  <td><Link to="/management/workshop-ageing">Workshop ageing</Link></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Stock & Data Health</h2>
            <Link to="/management/stock-exceptions">Stock exceptions</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Count</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Negative stock</td>
                  <td>{stockExceptions.negative}</td>
                  <td><Link to="/management/stock-exceptions">Investigate</Link></td>
                </tr>
                <tr>
                  <td>Zero stock with sales</td>
                  <td>{stockExceptions.zeroWithSales}</td>
                  <td><Link to="/management/inventory">Inventory intel</Link></td>
                </tr>
                <tr>
                  <td>Reorder-now items</td>
                  <td>{stockExceptions.reorderNow}</td>
                  <td><Link to="/management/reordering">Reordering</Link></td>
                </tr>
                <tr>
                  <td>Missing barcode / cost / price</td>
                  <td>{dataQuality.missingBarcode + dataQuality.missingCost + dataQuality.missingPrice}</td>
                  <td><Link to="/management/product-data">Product data</Link></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Recent Critical Activity</h2>
            <Link to="/management/activity">Audit activity</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                {criticalActivity.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No recent critical operational activity was found.</td>
                  </tr>
                ) : criticalActivity.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.createdAt).toLocaleString()}</td>
                    <td>{event.action}</td>
                    <td>{event.actorRole || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {isAdmin(user?.role) ? (
            <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
              Admin users can pair this page with <Link to="/management/admin-review">Admin Review</Link> for role and governance checks.
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
};
