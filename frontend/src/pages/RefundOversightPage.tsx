import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type RefundRow = {
  id: string;
  saleId: string;
  status: string;
  currency: string;
  subtotalPence: number;
  taxPence: number;
  totalPence: number;
  completedAt: string | null;
  createdAt: string;
  receiptNumber: string | null;
  saleReceiptNumber: string | null;
  lineCount: number;
  refundedUnits: number;
  tenderedPence: number;
  cashTenderPence: number;
  customer: {
    id: string;
    name: string;
  } | null;
};

type RefundListResponse = {
  refunds: RefundRow[];
};

type RangePreset = "7" | "30" | "90";

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

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

export const RefundOversightPage = () => {
  const { error } = useToasts();

  const [rangePreset, setRangePreset] = useState<RangePreset>("30");
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadRefunds = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const to = formatDateKey(today);
      const from = formatDateKey(shiftDays(today, -(Number(rangePreset) - 1)));
      const payload = await apiGet<RefundListResponse>(`/api/refunds?from=${from}&to=${to}`);
      setRefunds(payload.refunds || []);
    } catch (loadError) {
      setRefunds([]);
      error(loadError instanceof Error ? loadError.message : "Failed to load refund oversight");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRefunds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  const totals = useMemo(() => ({
    refundCount: refunds.length,
    totalPence: refunds.reduce((sum, refund) => sum + refund.totalPence, 0),
    cashPence: refunds.reduce((sum, refund) => sum + refund.cashTenderPence, 0),
    refundedUnits: refunds.reduce((sum, refund) => sum + refund.refundedUnits, 0),
  }), [refunds]);

  const averageRefundPence = totals.refundCount > 0 ? Math.round(totals.totalPence / totals.refundCount) : 0;

  const largeRefunds = useMemo(
    () => refunds
      .filter((refund) => refund.totalPence >= averageRefundPence && refund.totalPence > 0)
      .sort((left, right) => right.totalPence - left.totalPence)
      .slice(0, 10),
    [averageRefundPence, refunds],
  );

  const cashHeavyRefunds = useMemo(
    () => refunds
      .filter((refund) => refund.cashTenderPence > 0)
      .sort((left, right) => right.cashTenderPence - left.cashTenderPence)
      .slice(0, 10),
    [refunds],
  );

  const newestRefund = refunds[0] ?? null;

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Refund Oversight</h1>
            <p className="muted-text">
              Manager-facing visibility into recent refund activity. Exception signals are derived from current refund totals and cash mix only.
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
            <button type="button" onClick={() => void loadRefunds()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Refund Count</span>
            <strong className="metric-value">{totals.refundCount}</strong>
            <span className="dashboard-metric-detail">Completed refunds in range</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Refund Total</span>
            <strong className="metric-value">{formatMoney(totals.totalPence)}</strong>
            <span className="dashboard-metric-detail">Gross refunded value</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Cash Refund Total</span>
            <strong className="metric-value">{formatMoney(totals.cashPence)}</strong>
            <span className="dashboard-metric-detail">Cash-tendered refunds only</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Largest Recent Refund</span>
            <strong className="metric-value">
              {newestRefund ? formatMoney(Math.max(...refunds.map((refund) => refund.totalPence))) : "-"}
            </strong>
            <span className="dashboard-metric-detail">
              Avg refund {formatMoney(averageRefundPence)}
            </span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Recent Refunds</h2>
            <Link to="/management">Back to management</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Refund</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Cash</th>
                  <th>Units</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {refunds.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No refunds found in this range.</td>
                  </tr>
                ) : (
                  refunds.map((refund) => (
                    <tr key={refund.id}>
                      <td>
                        <div className="table-primary mono-text">{refund.id.slice(0, 8)}</div>
                        <div className="table-secondary">Sale {refund.saleId.slice(0, 8)}</div>
                      </td>
                      <td>{refund.customer?.name ?? "-"}</td>
                      <td>{refund.status}</td>
                      <td>{formatMoney(refund.totalPence)}</td>
                      <td>{formatMoney(refund.cashTenderPence)}</td>
                      <td>{refund.refundedUnits}</td>
                      <td>{refund.completedAt ? new Date(refund.completedAt).toLocaleString() : "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Large Refunds</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Refund</th>
                  <th>Customer</th>
                  <th>Total</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {largeRefunds.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No large-refund visibility for this range.</td>
                  </tr>
                ) : (
                  largeRefunds.map((refund) => (
                    <tr key={refund.id}>
                      <td className="mono-text">{refund.id.slice(0, 8)}</td>
                      <td>{refund.customer?.name ?? "-"}</td>
                      <td>{formatMoney(refund.totalPence)}</td>
                      <td>{refund.receiptNumber ?? refund.saleReceiptNumber ?? "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Cash Refund Visibility</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Refund</th>
                  <th>Customer</th>
                  <th>Cash Refunded</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {cashHeavyRefunds.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No cash refund activity in this range.</td>
                  </tr>
                ) : (
                  cashHeavyRefunds.map((refund) => (
                    <tr key={refund.id}>
                      <td className="mono-text">{refund.id.slice(0, 8)}</td>
                      <td>{refund.customer?.name ?? "-"}</td>
                      <td>{formatMoney(refund.cashTenderPence)}</td>
                      <td>{formatMoney(refund.totalPence)}</td>
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
