import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type DailyRow = {
  date: string;
  jobCount: number;
  revenuePence: number;
};

type DashboardJob = {
  id: string;
  status: string;
  scheduledDate: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  partsStatus?: "OK" | "UNALLOCATED" | "SHORT";
};

type DashboardResponse = {
  jobs: DashboardJob[];
};

type DayCard = {
  date: string;
  bookingCount: number;
  approvalCount: number;
  waitingPartsCount: number;
  unassignedCount: number;
  estimatedPressure: "Low" | "Moderate" | "High";
  jobs: DashboardJob[];
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

const OPEN_STATUSES = new Set([
  "BOOKING_MADE",
  "BIKE_ARRIVED",
  "WAITING_FOR_APPROVAL",
  "APPROVED",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "BIKE_READY",
]);

export const WorkshopCalendarPage = () => {
  const { error } = useToasts();
  const [windowDays, setWindowDays] = useState("14");
  const [dailyRows, setDailyRows] = useState<DailyRow[]>([]);
  const [jobs, setJobs] = useState<DashboardJob[]>([]);
  const [loading, setLoading] = useState(false);

  const loadCalendar = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const from = formatDateKey(shiftDays(today, -29));
      const to = formatDateKey(today);
      const futureTo = formatDateKey(shiftDays(today, Number(windowDays) - 1));
      const [dailyPayload, dashboardPayload] = await Promise.all([
        apiGet<DailyRow[]>(`/api/reports/workshop/daily?from=${from}&to=${to}`),
        apiGet<DashboardResponse>(`/api/workshop/dashboard?from=${formatDateKey(today)}&to=${futureTo}&includeCancelled=false&limit=200`),
      ]);
      setDailyRows(dailyPayload || []);
      setJobs((dashboardPayload.jobs || []).filter((job) => job.scheduledDate && OPEN_STATUSES.has(job.status)));
    } catch (loadError) {
      setDailyRows([]);
      setJobs([]);
      error(loadError instanceof Error ? loadError.message : "Failed to load workshop calendar");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDays]);

  const averageCompletedPerDay = useMemo(() => {
    if (dailyRows.length === 0) {
      return 0;
    }
    return dailyRows.reduce((sum, row) => sum + row.jobCount, 0) / dailyRows.length;
  }, [dailyRows]);

  const dayCards = useMemo<DayCard[]>(() => {
    const today = new Date();
    const cards: DayCard[] = [];
    for (let index = 0; index < Number(windowDays); index += 1) {
      const date = shiftDays(today, index);
      const dateKey = formatDateKey(date);
      const dayJobs = jobs.filter((job) => (job.scheduledDate || "").slice(0, 10) === dateKey);
      const bookingCount = dayJobs.length;
      const approvalCount = dayJobs.filter((job) => job.status === "WAITING_FOR_APPROVAL").length;
      const waitingPartsCount = dayJobs.filter((job) => job.status === "WAITING_FOR_PARTS" || job.partsStatus === "SHORT").length;
      const unassignedCount = dayJobs.filter((job) => !job.assignedStaffId).length;
      const pressureBase = averageCompletedPerDay > 0 ? bookingCount / averageCompletedPerDay : (bookingCount > 0 ? 99 : 0);
      const estimatedPressure = pressureBase >= 1.5 ? "High" : pressureBase >= 0.75 ? "Moderate" : "Low";

      cards.push({
        date: dateKey,
        bookingCount,
        approvalCount,
        waitingPartsCount,
        unassignedCount,
        estimatedPressure,
        jobs: dayJobs,
      });
    }
    return cards;
  }, [averageCompletedPerDay, jobs, windowDays]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Calendar & Capacity</h1>
            <p className="muted-text">
              Rolling planning view built from scheduled workshop jobs and recent workshop throughput. Capacity pressure is derived from open bookings divided by recent average completions.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Window
              <select value={windowDays} onChange={(event) => setWindowDays(event.target.value)}>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
              </select>
            </label>
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadCalendar()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Average Jobs / Day</span>
            <strong className="metric-value">{averageCompletedPerDay.toFixed(1)}</strong>
            <span className="dashboard-metric-detail">Based on last 30 days of completions</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Planned Days</span>
            <strong className="metric-value">{dayCards.length}</strong>
            <span className="dashboard-metric-detail">Rolling calendar horizon</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">High Pressure Days</span>
            <strong className="metric-value">{dayCards.filter((day) => day.estimatedPressure === "High").length}</strong>
            <span className="dashboard-metric-detail">Bookings exceed recent throughput</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Waiting Parts</span>
            <strong className="metric-value">{dayCards.reduce((sum, day) => sum + day.waitingPartsCount, 0)}</strong>
            <span className="dashboard-metric-detail">Parts-blocked jobs in planning window</span>
          </div>
        </div>
      </section>

      <div className="calendar-grid">
        {dayCards.map((day) => (
          <section key={day.date} className="card calendar-day-card">
            <div className="card-header-row">
              <div>
                <h2>{new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</h2>
                <p className="muted-text">{day.date}</p>
              </div>
              <span className={`status-badge ${day.estimatedPressure === "High" ? "status-warning" : day.estimatedPressure === "Moderate" ? "status-info" : "status-ready"}`}>
                {day.estimatedPressure}
              </span>
            </div>
            <div className="job-meta-grid">
              <div><strong>Bookings:</strong> {day.bookingCount}</div>
              <div><strong>Awaiting approval:</strong> {day.approvalCount}</div>
              <div><strong>Waiting parts:</strong> {day.waitingPartsCount}</div>
              <div><strong>Unassigned:</strong> {day.unassignedCount}</div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Assignee</th>
                  </tr>
                </thead>
                <tbody>
                  {day.jobs.length === 0 ? (
                    <tr>
                      <td colSpan={3}>No scheduled jobs.</td>
                    </tr>
                  ) : day.jobs.map((job) => (
                    <tr key={job.id}>
                      <td><Link to={`/workshop/${job.id}`}>{job.id.slice(0, 8)}</Link></td>
                      <td>{job.status}</td>
                      <td>{job.assignedStaffName || "Unassigned"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};
