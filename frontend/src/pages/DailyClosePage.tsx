import { useMemo, useState } from "react";
import { apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useAuth } from "../auth/AuthContext";
import { toBackendUrl } from "../utils/backendUrl";

type DailyClosePayload = {
  date: string;
  location: {
    id: string;
    code: string | null;
    name: string;
  };
  sales: {
    count: number;
    grossPence: number;
    tenderTotalsPence: {
      CASH: number;
      CARD: number;
      BANK_TRANSFER: number;
      VOUCHER: number;
    };
  };
  refunds: {
    count: number;
    totalPence: number;
    tenderTotalsPence: {
      CASH: number;
      CARD: number;
      VOUCHER: number;
      OTHER: number;
    };
  };
  netSalesPence: number;
  cashMovements: {
    floatPence: number;
    paidInPence: number;
    paidOutPence: number;
    cashSalesPence: number;
    cashRefundsPence: number;
    expectedCashInDrawerPence: number;
  };
  receipts: {
    count: number;
  };
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const DailyClosePage = () => {
  const { user } = useAuth();
  const { success, error } = useToasts();

  const [date, setDate] = useState(toDateKey(new Date()));
  const [locationCode, setLocationCode] = useState("MAIN");
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<DailyClosePayload | null>(null);

  const canAccess = user?.role === "MANAGER" || user?.role === "ADMIN";

  const printUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("date", date);
    if (locationCode.trim()) {
      params.set("locationCode", locationCode.trim().toUpperCase());
    }
    return `/reports/daily-close/print?${params.toString()}`;
  }, [date, locationCode]);

  const runDailyClose = async () => {
    setLoading(true);
    try {
      const result = await apiPost<DailyClosePayload>("/api/reports/daily-close", {
        date,
        ...(locationCode.trim() ? { locationCode: locationCode.trim().toUpperCase() } : {}),
      });
      setPayload(result);
      success("Daily close complete");
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "Failed to run daily close";
      error(message);
    } finally {
      setLoading(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="page-shell">
        <section className="card">
          <h1>Daily Close</h1>
          <p className="error-banner">Manager access required.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <section className="card">
        <h1>Daily Close</h1>
        <div className="filter-row">
          <label>
            Date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            Location Code
            <input
              value={locationCode}
              onChange={(event) => setLocationCode(event.target.value)}
              placeholder="MAIN"
            />
          </label>
          <button type="button" className="primary" onClick={() => void runDailyClose()} disabled={loading}>
            {loading ? "Running..." : "Run Daily Close"}
          </button>
          <a href={toBackendUrl(printUrl)} target="_blank" rel="noreferrer" className="button-link">
            Print
          </a>
        </div>
      </section>

      {payload ? (
        <>
          <section className="card">
            <h2>Summary</h2>
            <div className="job-meta-grid">
              <div><strong>Date:</strong> {payload.date}</div>
              <div><strong>Location:</strong> {payload.location.name}{payload.location.code ? ` (${payload.location.code})` : ""}</div>
              <div><strong>Sales Count:</strong> {payload.sales.count}</div>
              <div><strong>Receipts:</strong> {payload.receipts.count}</div>
              <div><strong>Gross Sales:</strong> {formatMoney(payload.sales.grossPence)}</div>
              <div><strong>Refunds:</strong> {formatMoney(payload.refunds.totalPence)}</div>
              <div><strong>Net Sales:</strong> {formatMoney(payload.netSalesPence)}</div>
              <div><strong>Expected Cash:</strong> {formatMoney(payload.cashMovements.expectedCashInDrawerPence)}</div>
            </div>
          </section>

          <section className="card">
            <h2>Tenders</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Sales</th>
                    <th>Refunds</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>CASH</td><td>{formatMoney(payload.sales.tenderTotalsPence.CASH)}</td><td>{formatMoney(payload.refunds.tenderTotalsPence.CASH)}</td></tr>
                  <tr><td>CARD</td><td>{formatMoney(payload.sales.tenderTotalsPence.CARD)}</td><td>{formatMoney(payload.refunds.tenderTotalsPence.CARD)}</td></tr>
                  <tr><td>BANK_TRANSFER</td><td>{formatMoney(payload.sales.tenderTotalsPence.BANK_TRANSFER)}</td><td>-</td></tr>
                  <tr><td>VOUCHER</td><td>{formatMoney(payload.sales.tenderTotalsPence.VOUCHER)}</td><td>{formatMoney(payload.refunds.tenderTotalsPence.VOUCHER)}</td></tr>
                  <tr><td>OTHER</td><td>-</td><td>{formatMoney(payload.refunds.tenderTotalsPence.OTHER)}</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>Cash Movements</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Float</td><td>{formatMoney(payload.cashMovements.floatPence)}</td></tr>
                  <tr><td>Paid In</td><td>{formatMoney(payload.cashMovements.paidInPence)}</td></tr>
                  <tr><td>Paid Out</td><td>{formatMoney(payload.cashMovements.paidOutPence)}</td></tr>
                  <tr><td>Cash Sales</td><td>{formatMoney(payload.cashMovements.cashSalesPence)}</td></tr>
                  <tr><td>Cash Refunds</td><td>{formatMoney(payload.cashMovements.cashRefundsPence)}</td></tr>
                  <tr><td><strong>Expected Cash In Drawer</strong></td><td>{formatMoney(payload.cashMovements.expectedCashInDrawerPence)}</td></tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
};
