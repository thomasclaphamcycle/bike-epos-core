import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type SalesDailyRow = {
  date: string;
  saleCount: number;
  grossPence: number;
  refundsPence: number;
  netPence: number;
};

type SalesListResponse = {
  sales: Array<{
    id: string;
    totalPence: number;
    payment: {
      method: "CASH" | "CARD" | "OTHER";
      amountPence: number;
    } | null;
  }>;
};

type RefundListResponse = {
  refunds: Array<{
    id: string;
    totalPence: number;
    completedAt: string | null;
  }>;
};

type CashSession = {
  id: string;
  businessDate: string;
  status: "OPEN" | "CLOSED";
};

type CashSessionListResponse = {
  sessions: CashSession[];
};

type CashSessionSummaryResponse = {
  session: CashSession | null;
  totals?: {
    expectedCashPence: number;
    countedCashPence: number | null;
    variancePence: number | null;
    cashSalesPence: number;
    cashRefundsPence: number;
  };
};

type WorkshopDailyRow = {
  date: string;
  jobCount: number;
  revenuePence: number;
};

type WorkshopDashboardResponse = {
  jobs: Array<{
    id: string;
    status: string;
  }>;
};

type PurchaseOrder = {
  id: string;
  status: "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  expectedAt: string | null;
  updatedAt: string;
  totals: {
    quantityRemaining: number;
    quantityReceived: number;
  };
  supplier: {
    name: string;
  };
};

type PurchaseOrderListResponse = {
  purchaseOrders: PurchaseOrder[];
};

const formatMoney = (pence: number | null | undefined) =>
  pence === null || pence === undefined ? "-" : `£${(pence / 100).toFixed(2)}`;

const formatDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const startOfDay = (value: string) => new Date(`${value}T00:00:00.000Z`);
const endOfDay = (value: string) => new Date(`${value}T23:59:59.999Z`);

export const DailyTradeClosePage = () => {
  const { error } = useToasts();

  const [date, setDate] = useState(() => formatDateKey(new Date()));
  const [salesRow, setSalesRow] = useState<SalesDailyRow | null>(null);
  const [sales, setSales] = useState<SalesListResponse["sales"]>([]);
  const [refunds, setRefunds] = useState<RefundListResponse["refunds"]>([]);
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [sessionSummaries, setSessionSummaries] = useState<CashSessionSummaryResponse[]>([]);
  const [workshopRow, setWorkshopRow] = useState<WorkshopDailyRow | null>(null);
  const [workshop, setWorkshop] = useState<WorkshopDashboardResponse | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTradeClose = async () => {
    setLoading(true);
    try {
      const [salesDailyResult, salesListResult, refundResult, sessionResult, workshopDailyResult, workshopResult, poResult] =
        await Promise.allSettled([
          apiGet<SalesDailyRow[]>(`/api/reports/sales/daily?from=${date}&to=${date}`),
          apiGet<SalesListResponse>(`/api/sales?from=${date}&to=${date}`),
          apiGet<RefundListResponse>(`/api/refunds?from=${date}&to=${date}`),
          apiGet<CashSessionListResponse>(`/api/till/sessions?from=${date}&to=${date}`),
          apiGet<WorkshopDailyRow[]>(`/api/reports/workshop/daily?from=${date}&to=${date}`),
          apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?includeCancelled=false&limit=150"),
          apiGet<PurchaseOrderListResponse>("/api/purchase-orders?take=200&skip=0"),
        ]);

      if (salesDailyResult.status === "fulfilled") {
        setSalesRow(salesDailyResult.value[0] ?? { date, saleCount: 0, grossPence: 0, refundsPence: 0, netPence: 0 });
      } else {
        setSalesRow(null);
        error(salesDailyResult.reason instanceof Error ? salesDailyResult.reason.message : "Failed to load sales daily report");
      }

      if (salesListResult.status === "fulfilled") {
        setSales(salesListResult.value.sales || []);
      } else {
        setSales([]);
        error(salesListResult.reason instanceof Error ? salesListResult.reason.message : "Failed to load visible tender mix");
      }

      if (refundResult.status === "fulfilled") {
        setRefunds(refundResult.value.refunds || []);
      } else {
        setRefunds([]);
        error(refundResult.reason instanceof Error ? refundResult.reason.message : "Failed to load refunds");
      }

      let daySessions: CashSession[] = [];
      if (sessionResult.status === "fulfilled") {
        daySessions = sessionResult.value.sessions || [];
        setSessions(daySessions);
      } else {
        setSessions([]);
        error(sessionResult.reason instanceof Error ? sessionResult.reason.message : "Failed to load till sessions");
      }

      if (workshopDailyResult.status === "fulfilled") {
        setWorkshopRow(workshopDailyResult.value[0] ?? { date, jobCount: 0, revenuePence: 0 });
      } else {
        setWorkshopRow(null);
        error(workshopDailyResult.reason instanceof Error ? workshopDailyResult.reason.message : "Failed to load workshop daily report");
      }

      if (workshopResult.status === "fulfilled") {
        setWorkshop(workshopResult.value);
      } else {
        setWorkshop(null);
        error(workshopResult.reason instanceof Error ? workshopResult.reason.message : "Failed to load workshop summary");
      }

      if (poResult.status === "fulfilled") {
        setPurchaseOrders(poResult.value.purchaseOrders || []);
      } else {
        setPurchaseOrders([]);
        error(poResult.reason instanceof Error ? poResult.reason.message : "Failed to load purchase orders");
      }

      if (daySessions.length > 0) {
        const summaries = await Promise.allSettled(
          daySessions.map((session) =>
            apiGet<CashSessionSummaryResponse>(`/api/till/sessions/${encodeURIComponent(session.id)}/summary`),
          ),
        );
        setSessionSummaries(
          summaries
            .filter((result): result is PromiseFulfilledResult<CashSessionSummaryResponse> => result.status === "fulfilled")
            .map((result) => result.value)
            .filter((result) => Boolean(result.session)),
        );
      } else {
        setSessionSummaries([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTradeClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const visibleTenderTotals = useMemo(() => {
    let cashPence = 0;
    let cardPence = 0;
    let otherPence = 0;
    for (const sale of sales) {
      if (!sale.payment) {
        continue;
      }
      if (sale.payment.method === "CASH") {
        cashPence += sale.payment.amountPence;
      } else if (sale.payment.method === "CARD") {
        cardPence += sale.payment.amountPence;
      } else {
        otherPence += sale.payment.amountPence;
      }
    }
    return { cashPence, cardPence, otherPence };
  }, [sales]);

  const tillSummary = useMemo(() => ({
    openCount: sessions.filter((session) => session.status === "OPEN").length,
    sessionCount: sessions.length,
    expectedCashPence: sessionSummaries.reduce((sum, summary) => sum + (summary.totals?.expectedCashPence ?? 0), 0),
    variancePence: sessionSummaries.reduce((sum, summary) => sum + (summary.totals?.variancePence ?? 0), 0),
    cashSalesPence: sessionSummaries.reduce((sum, summary) => sum + (summary.totals?.cashSalesPence ?? 0), 0),
    cashRefundsPence: sessionSummaries.reduce((sum, summary) => sum + (summary.totals?.cashRefundsPence ?? 0), 0),
  }), [sessionSummaries, sessions]);

  const workshopReadyCount = useMemo(
    () => workshop?.jobs.filter((job) => job.status === "BIKE_READY").length ?? 0,
    [workshop],
  );

  const dayStart = startOfDay(date).getTime();
  const dayEnd = endOfDay(date).getTime();

  const purchasingSummary = useMemo(() => {
    const receivingActivity = purchaseOrders.filter((po) => {
      const updated = new Date(po.updatedAt).getTime();
      return updated >= dayStart && updated <= dayEnd && po.totals.quantityReceived > 0;
    });

    const outstandingDeliveries = purchaseOrders.filter((po) =>
      (po.status === "SENT" || po.status === "PARTIALLY_RECEIVED") && po.totals.quantityRemaining > 0,
    );

    const overdue = outstandingDeliveries.filter((po) => po.expectedAt && new Date(po.expectedAt).getTime() < dayEnd);

    return {
      receivingActivity,
      outstandingDeliveries,
      overdue,
    };
  }, [dayEnd, dayStart, purchaseOrders]);

  const refundTotalPence = useMemo(
    () => refunds.reduce((sum, refund) => sum + refund.totalPence, 0),
    [refunds],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Daily Trade Close</h1>
            <p className="muted-text">
              Manager-facing daily close pack composed from the existing sales, refund, till, workshop, and purchasing surfaces. This is a practical control panel rather than a new close subsystem.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Date
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadTradeClose()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Total Sales</span>
            <strong className="metric-value">{formatMoney(salesRow?.grossPence ?? 0)}</strong>
            <span className="dashboard-metric-detail">{salesRow?.saleCount ?? 0} visible sales</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Total Refunds</span>
            <strong className="metric-value">{formatMoney(refundTotalPence)}</strong>
            <span className="dashboard-metric-detail">{refunds.length} refunds completed</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Net Revenue</span>
            <strong className="metric-value">{formatMoney(salesRow?.netPence ?? 0)}</strong>
            <span className="dashboard-metric-detail">Daily sales report net</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Open Tills</span>
            <strong className="metric-value">{tillSummary.openCount}</strong>
            <span className="dashboard-metric-detail">{tillSummary.sessionCount} till sessions on this date</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Workshop Completed</span>
            <strong className="metric-value">{workshopRow?.jobCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Revenue {formatMoney(workshopRow?.revenuePence ?? 0)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Bikes Ready</span>
            <strong className="metric-value">{workshopReadyCount}</strong>
            <span className="dashboard-metric-detail">Current ready-for-collection queue</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Tender Summary</h2>
            <Link to="/management/cash">Cash oversight</Link>
          </div>
          <div className="management-stat-grid">
            <div className="management-stat-card">
              <span className="metric-label">Card</span>
              <strong className="metric-value">{formatMoney(visibleTenderTotals.cardPence)}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Cash</span>
              <strong className="metric-value">{formatMoney(visibleTenderTotals.cashPence)}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Other</span>
              <strong className="metric-value">{formatMoney(visibleTenderTotals.otherPence)}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Till Expected Cash</span>
              <strong className="metric-value">{formatMoney(tillSummary.expectedCashPence)}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Visible Till Variance</span>
              <strong className="metric-value">{formatMoney(tillSummary.variancePence)}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Cash Sales / Refunds</span>
              <strong className="metric-value">{formatMoney(tillSummary.cashSalesPence - tillSummary.cashRefundsPence)}</strong>
              <span className="dashboard-metric-detail">
                Sales {formatMoney(tillSummary.cashSalesPence)} | Refunds {formatMoney(tillSummary.cashRefundsPence)}
              </span>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Workshop Summary</h2>
            <Link to="/workshop">Workshop</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Value</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Jobs completed today</td>
                  <td>{workshopRow?.jobCount ?? 0}</td>
                  <td><Link to="/management/workshop">Workshop metrics</Link></td>
                </tr>
                <tr>
                  <td>Workshop revenue today</td>
                  <td>{formatMoney(workshopRow?.revenuePence ?? 0)}</td>
                  <td><Link to="/management/workshop">Workshop metrics</Link></td>
                </tr>
                <tr>
                  <td>Bikes ready for collection</td>
                  <td>{workshopReadyCount}</td>
                  <td><Link to="/workshop/collection">Collection workflow</Link></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Purchasing Summary</h2>
            <Link to="/purchasing/receiving">Receiving</Link>
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
                  <td>Receiving activity today</td>
                  <td>{purchasingSummary.receivingActivity.length}</td>
                  <td><Link to="/purchasing/receiving">Receiving workspace</Link></td>
                </tr>
                <tr>
                  <td>Outstanding deliveries</td>
                  <td>{purchasingSummary.outstandingDeliveries.length}</td>
                  <td><Link to="/management/purchasing">PO action</Link></td>
                </tr>
                <tr>
                  <td>Overdue purchase orders</td>
                  <td>{purchasingSummary.overdue.length}</td>
                  <td><Link to="/management/purchasing">PO action</Link></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Receiving Activity Today</h2>
            <Link to="/management/purchasing">PO action</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Received Qty</th>
                </tr>
              </thead>
              <tbody>
                {purchasingSummary.receivingActivity.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No visible receiving activity on this date.</td>
                  </tr>
                ) : (
                  purchasingSummary.receivingActivity
                    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
                    .slice(0, 12)
                    .map((po) => (
                      <tr key={po.id}>
                        <td><Link to={`/purchasing/${po.id}`}>{po.id.slice(0, 8)}</Link></td>
                        <td>{po.supplier.name}</td>
                        <td>{po.status}</td>
                        <td>{new Date(po.updatedAt).toLocaleString()}</td>
                        <td>{po.totals.quantityReceived}</td>
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
