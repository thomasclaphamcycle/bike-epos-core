import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";

type LocationRow = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
};

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

const toQueryString = (params: Record<string, string>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value.trim()) {
      query.set(key, value.trim());
    }
  });
  const result = query.toString();
  return result ? `?${result}` : "";
};

export const ExportHubPage = () => {
  const today = new Date();
  const defaultTo = formatDateKey(today);
  const defaultFrom = formatDateKey(shiftDays(today, -29));

  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [paymentsStatus, setPaymentsStatus] = useState("");
  const [paymentsProvider, setPaymentsProvider] = useState("");
  const [locationId, setLocationId] = useState("");
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [tillSessionId, setTillSessionId] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const payload = await apiGet<LocationRow[]>("/api/locations");
        setLocations(payload || []);
      } catch {
        setLocations([]);
      }
    })();
  }, []);

  const exportLinks = useMemo(() => ({
    salesDaily: `/api/reports/sales/daily.csv${toQueryString({ from: fromDate, to: toDate })}`,
    workshopDaily: `/api/reports/workshop/daily.csv${toQueryString({ from: fromDate, to: toDate })}`,
    inventoryOnHand: `/api/reports/inventory/on-hand.csv${toQueryString({ locationId })}`,
    inventoryValue: `/api/reports/inventory/value.csv${toQueryString({ locationId })}`,
    payments: `/api/reports/payments${toQueryString({ from: fromDate, to: toDate, status: paymentsStatus, provider: paymentsProvider })}`,
    tillSummary: tillSessionId.trim() ? `/api/till/sessions/${encodeURIComponent(tillSessionId.trim())}/summary.csv` : "",
  }), [fromDate, locationId, paymentsProvider, paymentsStatus, tillSessionId, toDate]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Export Hub</h1>
            <p className="muted-text">
              Central management download hub for CSV exports already supported by the system. This first version links directly to the existing export endpoints.
            </p>
          </div>
          <Link to="/management">Back to management</Link>
        </div>

        <div className="filter-row">
          <label>
            From
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <label>
            Stock location
            <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">All locations</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name} ({location.code})</option>
              ))}
            </select>
          </label>
          <label>
            Payment status
            <input value={paymentsStatus} onChange={(event) => setPaymentsStatus(event.target.value)} placeholder="optional" />
          </label>
          <label>
            Payment provider
            <input value={paymentsProvider} onChange={(event) => setPaymentsProvider(event.target.value)} placeholder="optional" />
          </label>
          <label className="grow">
            Till session id
            <input value={tillSessionId} onChange={(event) => setTillSessionId(event.target.value)} placeholder="Required for till session summary CSV" />
          </label>
        </div>
      </section>

      <div className="export-grid">
        <section className="card export-card">
          <h2>Sales Daily CSV</h2>
          <p className="muted-text">Daily sales totals over the selected date range.</p>
          <a className="button-link" href={exportLinks.salesDaily}>Download sales_daily.csv</a>
        </section>
        <section className="card export-card">
          <h2>Workshop Daily CSV</h2>
          <p className="muted-text">Daily workshop completions and workshop revenue over the selected date range.</p>
          <a className="button-link" href={exportLinks.workshopDaily}>Download workshop_daily.csv</a>
        </section>
        <section className="card export-card">
          <h2>Inventory On-Hand CSV</h2>
          <p className="muted-text">Current on-hand inventory snapshot, optionally filtered to a stock location.</p>
          <a className="button-link" href={exportLinks.inventoryOnHand}>Download inventory_on_hand.csv</a>
        </section>
        <section className="card export-card">
          <h2>Inventory Value CSV</h2>
          <p className="muted-text">Current inventory valuation snapshot, optionally filtered to a stock location.</p>
          <a className="button-link" href={exportLinks.inventoryValue}>Download inventory_value.csv</a>
        </section>
        <section className="card export-card">
          <h2>Payments CSV</h2>
          <p className="muted-text">Payment events filtered by date range, and optionally by status/provider.</p>
          <a className="button-link" href={exportLinks.payments}>Download payments.csv</a>
        </section>
        <section className="card export-card">
          <h2>Till Session Summary CSV</h2>
          <p className="muted-text">Cash session summary export for a specific till session id.</p>
          {exportLinks.tillSummary ? (
            <a className="button-link" href={exportLinks.tillSummary}>Download cash-session summary CSV</a>
          ) : (
            <div className="restricted-panel info-panel">Enter a till session id above to enable this export.</div>
          )}
        </section>
      </div>
    </div>
  );
};
