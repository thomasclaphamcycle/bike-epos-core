import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type RangePreset = "30" | "90" | "365";

type WorkshopDashboardJob = {
  id: string;
  status: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  } | null;
  sale: {
    id: string;
    totalPence: number;
    createdAt: string;
  } | null;
  depositRequiredPence: number;
  depositStatus: string;
  assignedStaffName: string | null;
};

type WorkshopDashboardResponse = {
  summary: {
    deposits: {
      requiredCount: number;
      requiredAmountPence: number;
      paidCount: number;
      unpaidCount: number;
    };
  };
  jobs: WorkshopDashboardJob[];
};

type SaleDetailResponse = {
  sale: {
    id: string;
    totalPence: number;
    createdByStaff: {
      id: string;
      username: string;
      name: string | null;
    } | null;
  };
  tenderSummary: {
    totalPence: number;
    tenderedPence: number;
    remainingPence: number;
    changeDuePence: number;
  };
};

type WorkshopJobDetailResponse = {
  job: {
    id: string;
    customerName: string | null;
  };
  lines: Array<{
    id: string;
    description: string;
    lineTotalPence: number;
  }>;
};

type CustomerInsightRow = {
  customerId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  creditBalancePence: number;
  totalSpendPence: number;
  activeWorkshopJobs: number;
};

type CustomerInsightsResponse = {
  summary: {
    customersWithCreditCount: number;
    totalCreditBalancePence: number;
  };
  customers: CustomerInsightRow[];
};

type ReadyPaymentRow = {
  job: WorkshopDashboardJob;
  sale: SaleDetailResponse | null;
};

type AwaitingApprovalRow = {
  job: WorkshopDashboardJob;
  estimateTotalPence: number;
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

const customerName = (job: WorkshopDashboardJob) =>
  job.customer ? [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" ") || "-" : "-";

export const LiabilitiesReviewPage = () => {
  const { error } = useToasts();

  const [rangePreset, setRangePreset] = useState<RangePreset>("90");
  const [workshop, setWorkshop] = useState<WorkshopDashboardResponse | null>(null);
  const [creditReport, setCreditReport] = useState<CustomerInsightsResponse | null>(null);
  const [readyPaymentRows, setReadyPaymentRows] = useState<ReadyPaymentRow[]>([]);
  const [awaitingApprovalRows, setAwaitingApprovalRows] = useState<AwaitingApprovalRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadLiabilities = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const to = formatDateKey(today);
      const from = formatDateKey(shiftDays(today, -(Number(rangePreset) - 1)));

      const [workshopResult, creditResult] = await Promise.allSettled([
        apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?includeCancelled=false&limit=150"),
        apiGet<CustomerInsightsResponse>(`/api/reports/customers/insights?from=${from}&to=${to}&take=50`),
      ]);

      let workshopPayload: WorkshopDashboardResponse | null = null;
      if (workshopResult.status === "fulfilled") {
        workshopPayload = workshopResult.value;
        setWorkshop(workshopPayload);
      } else {
        setWorkshop(null);
        error(workshopResult.reason instanceof Error ? workshopResult.reason.message : "Failed to load workshop liabilities");
      }

      if (creditResult.status === "fulfilled") {
        setCreditReport(creditResult.value);
      } else {
        setCreditReport(null);
        error(creditResult.reason instanceof Error ? creditResult.reason.message : "Failed to load customer balances");
      }

      if (workshopPayload) {
        const readyJobs = workshopPayload.jobs.filter((job) => job.status === "BIKE_READY");
        const waitingApprovalJobs = workshopPayload.jobs.filter((job) => job.status === "WAITING_FOR_APPROVAL");

        const readySales = await Promise.allSettled(
          readyJobs
            .filter((job) => Boolean(job.sale?.id))
            .map(async (job) => ({
              job,
              sale: await apiGet<SaleDetailResponse>(`/api/sales/${encodeURIComponent(job.sale!.id)}`),
            })),
        );

        const readyRows = readyJobs.map((job) => {
          const match = readySales.find(
            (result): result is PromiseFulfilledResult<{ job: WorkshopDashboardJob; sale: SaleDetailResponse }> =>
              result.status === "fulfilled" && result.value.job.id === job.id,
          );
          return {
            job,
            sale: match?.value.sale ?? null,
          };
        });
        setReadyPaymentRows(readyRows);

        const approvalDetails = await Promise.allSettled(
          waitingApprovalJobs.slice(0, 40).map(async (job) => ({
            job,
            detail: await apiGet<WorkshopJobDetailResponse>(`/api/workshop/jobs/${encodeURIComponent(job.id)}`),
          })),
        );

        setAwaitingApprovalRows(
          approvalDetails
            .filter((result): result is PromiseFulfilledResult<{ job: WorkshopDashboardJob; detail: WorkshopJobDetailResponse }> => result.status === "fulfilled")
            .map((result) => ({
              job: result.value.job,
              estimateTotalPence: result.value.detail.lines.reduce((sum, line) => sum + line.lineTotalPence, 0),
            }))
            .sort((left, right) => right.estimateTotalPence - left.estimateTotalPence),
        );
      } else {
        setReadyPaymentRows([]);
        setAwaitingApprovalRows([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLiabilities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  const unpaidReadyRows = useMemo(
    () => readyPaymentRows.filter((row) => (row.sale?.tenderSummary.remainingPence ?? 0) > 0),
    [readyPaymentRows],
  );

  const readyWithoutLinkedSale = useMemo(
    () => readyPaymentRows.filter((row) => !row.sale),
    [readyPaymentRows],
  );

  const depositAttentionRows = useMemo(
    () => workshop?.jobs.filter((job) => job.depositRequiredPence > 0 && job.depositStatus !== "PAID") ?? [],
    [workshop],
  );

  const creditRows = useMemo(
    () => (creditReport?.customers || [])
      .filter((row) => row.creditBalancePence !== 0)
      .sort((left, right) => Math.abs(right.creditBalancePence) - Math.abs(left.creditBalancePence)),
    [creditReport],
  );

  const summary = useMemo(() => ({
    unpaidReadyCount: unpaidReadyRows.length,
    unpaidReadyTotalPence: unpaidReadyRows.reduce((sum, row) => sum + (row.sale?.tenderSummary.remainingPence ?? 0), 0),
    depositExposurePence: depositAttentionRows.reduce((sum, job) => sum + job.depositRequiredPence, 0),
    approvalEstimatePence: awaitingApprovalRows.reduce((sum, row) => sum + row.estimateTotalPence, 0),
  }), [awaitingApprovalRows, depositAttentionRows, unpaidReadyRows]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Liabilities & Deposits Review</h1>
            <p className="muted-text">
              Manager-facing visibility into unpaid workshop balances, deposit exposure, customer credit, and approval-stage estimated liabilities using the current workshop, sales, and customer signals.
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
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadLiabilities()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Unpaid Ready Jobs</span>
            <strong className="metric-value">{summary.unpaidReadyCount}</strong>
            <span className="dashboard-metric-detail">Remaining {formatMoney(summary.unpaidReadyTotalPence)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Deposit Exposure</span>
            <strong className="metric-value">{formatMoney(summary.depositExposurePence)}</strong>
            <span className="dashboard-metric-detail">{depositAttentionRows.length} jobs with unpaid deposit requirement</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Customer Credit</span>
            <strong className="metric-value">{formatMoney(creditReport?.summary.totalCreditBalancePence ?? 0)}</strong>
            <span className="dashboard-metric-detail">{creditReport?.summary.customersWithCreditCount ?? 0} customers with non-zero balance</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Awaiting Approval</span>
            <strong className="metric-value">{awaitingApprovalRows.length}</strong>
            <span className="dashboard-metric-detail">Estimated total {formatMoney(summary.approvalEstimatePence)}</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Ready For Collection But Unpaid</h2>
            <Link to="/workshop/collection">Collection workflow</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Invoice</th>
                  <th>Remaining</th>
                  <th>Deposit</th>
                </tr>
              </thead>
              <tbody>
                {unpaidReadyRows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No ready-for-collection jobs currently show an outstanding visible balance.</td>
                  </tr>
                ) : (
                  unpaidReadyRows.map((row) => (
                    <tr key={row.job.id}>
                      <td><Link to={`/workshop/${row.job.id}`}>{row.job.id.slice(0, 8)}</Link></td>
                      <td>{customerName(row.job)}</td>
                      <td>{row.sale ? <Link to={`/pos?saleId=${row.sale.sale.id}`}>{row.sale.sale.id.slice(0, 8)}</Link> : "-"}</td>
                      <td>{formatMoney(row.sale?.tenderSummary.remainingPence ?? 0)}</td>
                      <td>{formatMoney(row.job.depositRequiredPence)} / {row.job.depositStatus}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Deposit Attention</h2>
            <Link to="/workshop">Workshop</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Deposit Required</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {depositAttentionRows.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No open deposit attention items were found.</td>
                  </tr>
                ) : (
                  depositAttentionRows.map((job) => (
                    <tr key={job.id}>
                      <td><Link to={`/workshop/${job.id}`}>{job.id.slice(0, 8)}</Link></td>
                      <td>{customerName(job)}</td>
                      <td>{formatMoney(job.depositRequiredPence)}</td>
                      <td>{job.depositStatus}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Customer Balances</h2>
            <Link to="/management/customers">Customer insights</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Credit Balance</th>
                  <th>Open Workshop Jobs</th>
                  <th>Total Spend</th>
                </tr>
              </thead>
              <tbody>
                {creditRows.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No non-zero customer balances in the selected range.</td>
                  </tr>
                ) : (
                  creditRows.slice(0, 20).map((row) => (
                    <tr key={row.customerId}>
                      <td><Link to={`/customers/${row.customerId}`}>{row.customerName}</Link></td>
                      <td>{formatMoney(row.creditBalancePence)}</td>
                      <td>{row.activeWorkshopJobs}</td>
                      <td>{formatMoney(row.totalSpendPence)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Awaiting Approval Estimated Cost</h2>
            <Link to="/management/communications">Comms queue</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Estimated Cost</th>
                  <th>Assigned</th>
                </tr>
              </thead>
              <tbody>
                {awaitingApprovalRows.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No waiting-for-approval jobs were found.</td>
                  </tr>
                ) : (
                  awaitingApprovalRows.map((row) => (
                    <tr key={row.job.id}>
                      <td><Link to={`/workshop/${row.job.id}`}>{row.job.id.slice(0, 8)}</Link></td>
                      <td>{customerName(row.job)}</td>
                      <td>{formatMoney(row.estimateTotalPence)}</td>
                      <td>{row.job.assignedStaffName ?? "Unassigned"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {readyWithoutLinkedSale.length > 0 ? (
        <section className="card">
          <div className="card-header-row">
            <h2>Ready Jobs Without Linked Invoice</h2>
            <Link to="/workshop/collection">Collection workflow</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Deposit</th>
                </tr>
              </thead>
              <tbody>
                {readyWithoutLinkedSale.map((row) => (
                  <tr key={row.job.id}>
                    <td><Link to={`/workshop/${row.job.id}`}>{row.job.id.slice(0, 8)}</Link></td>
                    <td>{customerName(row.job)}</td>
                    <td>{formatMoney(row.job.depositRequiredPence)} / {row.job.depositStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
};
