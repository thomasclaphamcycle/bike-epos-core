import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type RangePreset = "30" | "90" | "365";

type CustomerInsightRow = {
  customerId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  saleCount: number;
  totalSpendPence: number;
  averageOrderValuePence: number;
  totalWorkshopJobs: number;
  activeWorkshopJobs: number;
  recentWorkshopJobs: number;
  creditBalancePence: number;
  lastSaleAt: string | null;
  lastWorkshopAt: string | null;
  lastActivityAt: string | null;
  isRepeatCustomer: boolean;
  isHighValueCustomer: boolean;
};

type CustomerInsightsResponse = {
  summary: {
    customerCount: number;
    activeCustomerCount: number;
    repeatCustomerCount: number;
    highValueCustomerCount: number;
    workshopActiveCustomerCount: number;
    customersWithCreditCount: number;
    totalCreditBalancePence: number;
    averageSpendPence: number;
  };
  topCustomers: CustomerInsightRow[];
  repeatCustomers: CustomerInsightRow[];
  recentActivityCustomers: CustomerInsightRow[];
  workshopActiveCustomers: CustomerInsightRow[];
  customers: CustomerInsightRow[];
  creditSupported: boolean;
};

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

export const CustomerInsightsPage = () => {
  const { error } = useToasts();

  const [rangePreset, setRangePreset] = useState<RangePreset>("90");
  const [report, setReport] = useState<CustomerInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const to = formatDateKey(today);
      const from = formatDateKey(shiftDays(today, -(Number(rangePreset) - 1)));
      const payload = await apiGet<CustomerInsightsResponse>(
        `/api/reports/customers/insights?from=${from}&to=${to}&take=10`,
      );
      setReport(payload);
    } catch (loadError) {
      setReport(null);
      error(loadError instanceof Error ? loadError.message : "Failed to load customer insights");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  const highestValue = useMemo(() => report?.topCustomers[0] ?? null, [report]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Customer Insights</h1>
            <p className="muted-text">
              Manager-facing CRM summary using existing customer, sales, workshop, and credit data. This stays practical and operational rather than becoming a marketing system.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Range
              <select value={rangePreset} onChange={(event) => setRangePreset(event.target.value as RangePreset)}>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="365">Last 365 days</option>
              </select>
            </label>
            <button type="button" onClick={() => void loadReport()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Customers</span>
            <strong className="metric-value">{report?.summary.customerCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Known customer records</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Active Customers</span>
            <strong className="metric-value">{report?.summary.activeCustomerCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Sales or active workshop activity</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Repeat Customers</span>
            <strong className="metric-value">{report?.summary.repeatCustomerCount ?? 0}</strong>
            <span className="dashboard-metric-detail">2+ completed sales in range</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Workshop-Active</span>
            <strong className="metric-value">{report?.summary.workshopActiveCustomerCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Customers with open workshop jobs</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Credit Exposure</span>
            <strong className="metric-value">{formatMoney(report?.summary.totalCreditBalancePence ?? 0)}</strong>
            <span className="dashboard-metric-detail">
              {report?.summary.customersWithCreditCount ?? 0} customers with non-zero balance
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Highest Value Customer</span>
            <strong className="metric-value">{highestValue?.customerName ?? "-"}</strong>
            <span className="dashboard-metric-detail">
              {highestValue ? formatMoney(highestValue.totalSpendPence) : "No data"}
            </span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>High-Value Customers</h2>
            <Link to="/management">Back to management</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Sales</th>
                  <th>Total Spend</th>
                  <th>Avg Order</th>
                  <th>Credit</th>
                  <th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {report?.topCustomers.length ? report.topCustomers.map((row) => (
                  <tr key={row.customerId}>
                    <td>
                      <Link to={`/customers/${row.customerId}`}>{row.customerName}</Link>
                    </td>
                    <td>{row.saleCount}</td>
                    <td>{formatMoney(row.totalSpendPence)}</td>
                    <td>{formatMoney(row.averageOrderValuePence)}</td>
                    <td>{formatMoney(row.creditBalancePence)}</td>
                    <td>{row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleString() : "-"}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6}>No high-value customers found for this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Repeat Customers</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Sales</th>
                  <th>Total Spend</th>
                  <th>Last Sale</th>
                </tr>
              </thead>
              <tbody>
                {report?.repeatCustomers.length ? report.repeatCustomers.map((row) => (
                  <tr key={row.customerId}>
                    <td><Link to={`/customers/${row.customerId}`}>{row.customerName}</Link></td>
                    <td>{row.saleCount}</td>
                    <td>{formatMoney(row.totalSpendPence)}</td>
                    <td>{row.lastSaleAt ? new Date(row.lastSaleAt).toLocaleString() : "-"}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4}>No repeat customers in this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Recent Customer Activity</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Last Activity</th>
                  <th>Sales</th>
                  <th>Open Workshop Jobs</th>
                </tr>
              </thead>
              <tbody>
                {report?.recentActivityCustomers.length ? report.recentActivityCustomers.map((row) => (
                  <tr key={row.customerId}>
                    <td><Link to={`/customers/${row.customerId}`}>{row.customerName}</Link></td>
                    <td>{row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleString() : "-"}</td>
                    <td>{row.saleCount}</td>
                    <td>{row.activeWorkshopJobs}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4}>No recent customer activity in this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Workshop-Active Customers</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Open Workshop Jobs</th>
                  <th>Total Workshop Jobs</th>
                  <th>Last Workshop Activity</th>
                </tr>
              </thead>
              <tbody>
                {report?.workshopActiveCustomers.length ? report.workshopActiveCustomers.map((row) => (
                  <tr key={row.customerId}>
                    <td><Link to={`/customers/${row.customerId}`}>{row.customerName}</Link></td>
                    <td>{row.activeWorkshopJobs}</td>
                    <td>{row.totalWorkshopJobs}</td>
                    <td>{row.lastWorkshopAt ? new Date(row.lastWorkshopAt).toLocaleString() : "-"}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4}>No workshop-active customers found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Scope Notes</h2>
          </div>
          <div className="restricted-panel info-panel">
            This page reports current customer, sales, workshop, and credit signals only. It does not attempt speculative segmentation or marketing scoring. High-value customers are defined as customers at or above the current range average spend.
          </div>
        </section>
      </div>
    </div>
  );
};
