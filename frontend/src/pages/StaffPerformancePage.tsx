import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import {
  isWorkshopAwaitingApproval,
  isWorkshopReadyForCollection,
  isWorkshopWaitingForParts,
  isWorkshopOpen,
} from "../utils/workshopStatus";

type RangePreset = "7" | "30" | "90";

type DashboardJob = {
  id: string;
  status: string;
  executionStatus?: string | null;
  currentEstimateStatus?: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  partsStatus?: "OK" | "UNALLOCATED" | "SHORT";
  updatedAt: string;
};

type WorkshopDashboardResponse = {
  summary: {
    totalJobs: number;
    dueToday: number;
    overdue: number;
  };
  jobs: DashboardJob[];
};

type SalesListResponse = {
  sales: Array<{
    id: string;
    totalPence: number;
    createdAt: string;
  }>;
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
};

type StaffRow = {
  key: string;
  label: string;
  jobsCompleted: number;
  openJobs: number;
  awaitingApproval: number;
  waitingForParts: number;
  ready: number;
  salesCount: number;
  salesValuePence: number;
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

const groupKey = (staffId: string | null, staffName: string | null) => ({
  key: staffId ?? "unassigned",
  label: staffName?.trim() || "Unassigned",
});

export const StaffPerformancePage = () => {
  const { error } = useToasts();

  const [rangePreset, setRangePreset] = useState<RangePreset>("30");
  const [openDashboard, setOpenDashboard] = useState<WorkshopDashboardResponse | null>(null);
  const [completedDashboard, setCompletedDashboard] = useState<WorkshopDashboardResponse | null>(null);
  const [salesRows, setSalesRows] = useState<SalesListResponse["sales"]>([]);
  const [saleDetails, setSaleDetails] = useState<SaleDetailResponse[]>([]);
  const [loading, setLoading] = useState(false);

  const loadPerformance = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const to = formatDateKey(today);
      const from = formatDateKey(shiftDays(today, -(Number(rangePreset) - 1)));

      const [openResult, completedResult, salesResult] = await Promise.allSettled([
        apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?includeCancelled=false&limit=150"),
        apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?status=COMPLETED&includeCancelled=true&limit=200"),
        apiGet<SalesListResponse>(`/api/sales?from=${from}&to=${to}`),
      ]);

      let nextSales: SalesListResponse["sales"] = [];

      if (openResult.status === "fulfilled") {
        setOpenDashboard(openResult.value);
      } else {
        setOpenDashboard(null);
        error(openResult.reason instanceof Error ? openResult.reason.message : "Failed to load open workshop workload");
      }

      if (completedResult.status === "fulfilled") {
        setCompletedDashboard(completedResult.value);
      } else {
        setCompletedDashboard(null);
        error(completedResult.reason instanceof Error ? completedResult.reason.message : "Failed to load completed workshop jobs");
      }

      if (salesResult.status === "fulfilled") {
        nextSales = salesResult.value.sales || [];
        setSalesRows(nextSales);
      } else {
        setSalesRows([]);
        error(salesResult.reason instanceof Error ? salesResult.reason.message : "Failed to load visible sales activity");
      }

      if (nextSales.length > 0) {
        const details = await Promise.allSettled(
          nextSales.map((sale) => apiGet<SaleDetailResponse>(`/api/sales/${encodeURIComponent(sale.id)}`)),
        );
        setSaleDetails(
          details
            .filter((result): result is PromiseFulfilledResult<SaleDetailResponse> => result.status === "fulfilled")
            .map((result) => result.value),
        );
      } else {
        setSaleDetails([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPerformance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  const openJobs = openDashboard?.jobs ?? [];
  const completedJobs = completedDashboard?.jobs ?? [];
  const completedCutoff = useMemo(
    () => shiftDays(new Date(), -(Number(rangePreset) - 1)).getTime(),
    [rangePreset],
  );
  const completedJobsInRange = useMemo(
    () => completedJobs.filter((job) => new Date(job.updatedAt).getTime() >= completedCutoff),
    [completedCutoff, completedJobs],
  );

  const completedByStaff = useMemo(() => {
    const grouped = new Map<string, StaffRow>();

    for (const job of completedJobsInRange) {
      const { key, label } = groupKey(job.assignedStaffId, job.assignedStaffName);
      const row = grouped.get(key) ?? {
        key,
        label,
        jobsCompleted: 0,
        openJobs: 0,
        awaitingApproval: 0,
        waitingForParts: 0,
        ready: 0,
        salesCount: 0,
        salesValuePence: 0,
      };
      row.jobsCompleted += 1;
      grouped.set(key, row);
    }

    return grouped;
  }, [completedJobsInRange]);

  const staffRows = useMemo(() => {
    const grouped = new Map<string, StaffRow>(completedByStaff);

    for (const job of openJobs) {
      if (!isWorkshopOpen(job)) {
        continue;
      }
      const { key, label } = groupKey(job.assignedStaffId, job.assignedStaffName);
      const row = grouped.get(key) ?? {
        key,
        label,
        jobsCompleted: 0,
        openJobs: 0,
        awaitingApproval: 0,
        waitingForParts: 0,
        ready: 0,
        salesCount: 0,
        salesValuePence: 0,
      };
      row.openJobs += 1;
      if (isWorkshopAwaitingApproval(job)) {
        row.awaitingApproval += 1;
      }
      if (isWorkshopWaitingForParts(job)) {
        row.waitingForParts += 1;
      }
      if (isWorkshopReadyForCollection(job)) {
        row.ready += 1;
      }
      grouped.set(key, row);
    }

    for (const sale of saleDetails) {
      const staff = sale.sale.createdByStaff;
      const key = staff?.id ?? "unknown-sale-staff";
      const label = staff?.name?.trim() || staff?.username || "Unknown";
      const row = grouped.get(key) ?? {
        key,
        label,
        jobsCompleted: 0,
        openJobs: 0,
        awaitingApproval: 0,
        waitingForParts: 0,
        ready: 0,
        salesCount: 0,
        salesValuePence: 0,
      };
      row.salesCount += 1;
      row.salesValuePence += sale.sale.totalPence;
      grouped.set(key, row);
    }

    return Array.from(grouped.values()).sort((left, right) => (
      right.jobsCompleted - left.jobsCompleted
      || right.openJobs - left.openJobs
      || right.salesCount - left.salesCount
      || left.label.localeCompare(right.label)
    ));
  }, [completedByStaff, openJobs, saleDetails]);

  const summary = useMemo(() => ({
    workshopCompleted: completedJobsInRange.length,
    assignedOpenJobs: openJobs.filter((job) => job.assignedStaffId && isWorkshopOpen(job)).length,
    unassignedJobs: openJobs.filter((job) => !job.assignedStaffId && isWorkshopOpen(job)).length,
    visibleSales: saleDetails.length,
  }), [completedJobsInRange.length, openJobs, saleDetails.length]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Staff Activity & Throughput</h1>
            <p className="muted-text">
              Manager-facing operational view of workshop workload and visible sales handling by staff. Workshop completion uses the current completed-job view, and sales activity uses visible sale creator data where present.
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
            <button type="button" onClick={() => void loadPerformance()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Workshop Completed</span>
            <strong className="metric-value">{summary.workshopCompleted}</strong>
            <span className="dashboard-metric-detail">Visible completed jobs</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Assigned Open Jobs</span>
            <strong className="metric-value">{summary.assignedOpenJobs}</strong>
            <span className="dashboard-metric-detail">Current assigned workshop load</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Unassigned Jobs</span>
            <strong className="metric-value">{summary.unassignedJobs}</strong>
            <span className="dashboard-metric-detail">Open jobs needing ownership</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Visible Sales Activity</span>
            <strong className="metric-value">{summary.visibleSales}</strong>
            <span className="dashboard-metric-detail">Sales with creator visibility in range</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Throughput By Staff</h2>
            <Link to="/management/workshop">Workshop metrics</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Completed Jobs</th>
                  <th>Open Jobs</th>
                  <th>Awaiting Approval</th>
                  <th>Waiting For Parts</th>
                  <th>Ready</th>
                </tr>
              </thead>
              <tbody>
                {staffRows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No visible staff activity in the selected range.</td>
                  </tr>
                ) : (
                  staffRows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>{row.jobsCompleted}</td>
                      <td>{row.openJobs}</td>
                      <td>{row.awaitingApproval}</td>
                      <td>{row.waitingForParts}</td>
                      <td>{row.ready}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Visible Sales By Staff</h2>
            <Link to="/management/sales">Sales analytics</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Sales Count</th>
                  <th>Sales Value</th>
                </tr>
              </thead>
              <tbody>
                {staffRows.filter((row) => row.salesCount > 0).length === 0 ? (
                  <tr>
                    <td colSpan={3}>No visible per-staff sales activity is available for this range.</td>
                  </tr>
                ) : (
                  staffRows
                    .filter((row) => row.salesCount > 0)
                    .sort((left, right) => right.salesValuePence - left.salesValuePence)
                    .map((row) => (
                      <tr key={`sales-${row.key}`}>
                        <td>{row.label}</td>
                        <td>{row.salesCount}</td>
                        <td>{formatMoney(row.salesValuePence)}</td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Current Workload</h2>
            <Link to="/workshop">Workshop</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Open Jobs</th>
                  <th>Ready</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {staffRows.filter((row) => row.openJobs > 0).length === 0 ? (
                  <tr>
                    <td colSpan={4}>No current assigned workshop load.</td>
                  </tr>
                ) : (
                  staffRows
                    .filter((row) => row.openJobs > 0)
                    .sort((left, right) => right.openJobs - left.openJobs)
                    .map((row) => (
                      <tr key={`workload-${row.key}`}>
                        <td>{row.label}</td>
                        <td>{row.openJobs}</td>
                        <td>{row.ready}</td>
                        <td><Link to="/workshop">Workshop board</Link></td>
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
