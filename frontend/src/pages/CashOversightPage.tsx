import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type RangePreset = "7" | "30" | "90";

type CashSummaryResponse = {
  totals: {
    floatPence: number;
    paidInPence: number;
    paidOutPence: number;
    cashSalesPence: number;
    cashRefundsPence: number;
    expectedCashOnHandPence: number;
  };
};

type CashMovement = {
  id: string;
  sessionId: string | null;
  locationId: string;
  type: string;
  dbType: string;
  amountPence: number;
  note: string | null;
  ref: string;
  relatedSaleId: string | null;
  relatedRefundId: string | null;
  createdAt: string;
  createdByStaffId: string | null;
};

type CashMovementListResponse = {
  movements: CashMovement[];
};

type CashSession = {
  id: string;
  businessDate: string;
  openedAt: string;
  closedAt: string | null;
  openedByStaffId: string | null;
  closedByStaffId: string | null;
  openingFloatPence: number;
  status: "OPEN" | "CLOSED";
  createdAt: string;
  updatedAt: string;
};

type CashSessionListResponse = {
  sessions: CashSession[];
};

type CashSessionSummaryResponse = {
  session: CashSession | null;
  totals?: {
    openingFloatPence: number;
    paidInPence: number;
    paidOutPence: number;
    cashSalesPence: number;
    cashRefundsPence: number;
    expectedCashPence: number;
    countedCashPence: number | null;
    variancePence: number | null;
  };
};

const formatMoney = (pence: number | null | undefined) =>
  pence === null || pence === undefined ? "-" : `£${(pence / 100).toFixed(2)}`;

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

export const CashOversightPage = () => {
  const { error } = useToasts();

  const [rangePreset, setRangePreset] = useState<RangePreset>("30");
  const [cashSummary, setCashSummary] = useState<CashSummaryResponse | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [currentSession, setCurrentSession] = useState<CashSessionSummaryResponse | null>(null);
  const [recentSessionSummaries, setRecentSessionSummaries] = useState<CashSessionSummaryResponse[]>([]);
  const [loading, setLoading] = useState(false);

  const loadCashOversight = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const to = formatDateKey(today);
      const from = formatDateKey(shiftDays(today, -(Number(rangePreset) - 1)));

      const [summaryResult, movementResult, sessionResult, currentResult] = await Promise.allSettled([
        apiGet<CashSummaryResponse>(`/api/cash/summary?from=${from}&to=${to}`),
        apiGet<CashMovementListResponse>(`/api/cash/movements?from=${from}&to=${to}`),
        apiGet<CashSessionListResponse>(`/api/till/sessions?from=${from}&to=${to}`),
        apiGet<CashSessionSummaryResponse>("/api/till/sessions/current"),
      ]);

      let nextSessions: CashSession[] = [];

      if (summaryResult.status === "fulfilled") {
        setCashSummary(summaryResult.value);
      } else {
        setCashSummary(null);
        error(summaryResult.reason instanceof Error ? summaryResult.reason.message : "Failed to load cash summary");
      }

      if (movementResult.status === "fulfilled") {
        setMovements(movementResult.value.movements || []);
      } else {
        setMovements([]);
        error(movementResult.reason instanceof Error ? movementResult.reason.message : "Failed to load cash movements");
      }

      if (sessionResult.status === "fulfilled") {
        nextSessions = sessionResult.value.sessions || [];
        setSessions(nextSessions);
      } else {
        setSessions([]);
        error(sessionResult.reason instanceof Error ? sessionResult.reason.message : "Failed to load cash sessions");
      }

      if (currentResult.status === "fulfilled") {
        setCurrentSession(currentResult.value);
      } else {
        setCurrentSession(null);
        error(currentResult.reason instanceof Error ? currentResult.reason.message : "Failed to load current till session");
      }

      if (nextSessions.length > 0) {
        const summaryPayloads = await Promise.allSettled(
          nextSessions.slice(0, 5).map((session) =>
            apiGet<CashSessionSummaryResponse>(`/api/till/sessions/${encodeURIComponent(session.id)}/summary`),
          ),
        );

        setRecentSessionSummaries(
          summaryPayloads
            .filter((result): result is PromiseFulfilledResult<CashSessionSummaryResponse> => result.status === "fulfilled")
            .map((result) => result.value)
            .filter((result) => Boolean(result.session)),
        );
      } else {
        setRecentSessionSummaries([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCashOversight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  const openSessions = useMemo(
    () => sessions.filter((session) => session.status === "OPEN"),
    [sessions],
  );

  const varianceSessions = useMemo(
    () => recentSessionSummaries.filter((summary) => summary.totals?.variancePence !== null),
    [recentSessionSummaries],
  );

  const strongestVariance = useMemo(() => {
    if (varianceSessions.length === 0) {
      return null;
    }
    return [...varianceSessions].sort((left, right) => (
      Math.abs(right.totals?.variancePence ?? 0) - Math.abs(left.totals?.variancePence ?? 0)
    ))[0];
  }, [varianceSessions]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Cash & Till Oversight</h1>
            <p className="muted-text">
              Manager-facing till and cash movement visibility built from the existing till session and cash movement endpoints.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Range
              <select value={rangePreset} onChange={(event) => setRangePreset(event.target.value as RangePreset)}>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </label>
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadCashOversight()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Open Tills</span>
            <strong className="metric-value">{openSessions.length}</strong>
            <span className="dashboard-metric-detail">
              Current session {currentSession?.session ? currentSession.session.id.slice(0, 8) : "none"}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Expected Cash On Hand</span>
            <strong className="metric-value">{formatMoney(cashSummary?.totals.expectedCashOnHandPence)}</strong>
            <span className="dashboard-metric-detail">Across selected range</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Cash Sales / Refunds</span>
            <strong className="metric-value">
              {formatMoney((cashSummary?.totals.cashSalesPence ?? 0) - (cashSummary?.totals.cashRefundsPence ?? 0))}
            </strong>
            <span className="dashboard-metric-detail">
              Sales {formatMoney(cashSummary?.totals.cashSalesPence)} | Refunds {formatMoney(cashSummary?.totals.cashRefundsPence)}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Largest Visible Variance</span>
            <strong className="metric-value">{formatMoney(strongestVariance?.totals?.variancePence)}</strong>
            <span className="dashboard-metric-detail">
              {strongestVariance?.session ? `Session ${strongestVariance.session.id.slice(0, 8)}` : "No counted session variance"}
            </span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Current Till</h2>
            <Link to="/management">Back to management</Link>
          </div>
          <div className="management-stat-grid">
            <div className="management-stat-card">
              <span className="metric-label">Session</span>
              <strong className="metric-value">{currentSession?.session ? currentSession.session.id.slice(0, 8) : "-"}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Expected Cash</span>
              <strong className="metric-value">{formatMoney(currentSession?.totals?.expectedCashPence)}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Counted Cash</span>
              <strong className="metric-value">{formatMoney(currentSession?.totals?.countedCashPence)}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Variance</span>
              <strong className="metric-value">{formatMoney(currentSession?.totals?.variancePence)}</strong>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Recent Session Summaries</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Business Date</th>
                  <th>Status</th>
                  <th>Expected</th>
                  <th>Counted</th>
                  <th>Variance</th>
                </tr>
              </thead>
              <tbody>
                {recentSessionSummaries.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No till session summaries available for this range.</td>
                  </tr>
                ) : (
                  recentSessionSummaries.map((summary) => (
                    <tr key={summary.session?.id}>
                      <td className="mono-text">{summary.session?.id.slice(0, 8)}</td>
                      <td>{summary.session?.businessDate ? new Date(summary.session.businessDate).toLocaleDateString() : "-"}</td>
                      <td>{summary.session?.status ?? "-"}</td>
                      <td>{formatMoney(summary.totals?.expectedCashPence)}</td>
                      <td>{formatMoney(summary.totals?.countedCashPence)}</td>
                      <td>{formatMoney(summary.totals?.variancePence)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Recent Cash Movements</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Reference</th>
                  <th>Staff</th>
                </tr>
              </thead>
              <tbody>
                {movements.slice(0, 20).length === 0 ? (
                  <tr>
                    <td colSpan={5}>No cash movements found in this range.</td>
                  </tr>
                ) : (
                  movements.slice(0, 20).map((movement) => (
                    <tr key={movement.id}>
                      <td>{new Date(movement.createdAt).toLocaleString()}</td>
                      <td>{movement.type}</td>
                      <td>{formatMoney(movement.amountPence)}</td>
                      <td className="mono-text">{movement.ref}</td>
                      <td>{movement.createdByStaffId ?? "-"}</td>
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
