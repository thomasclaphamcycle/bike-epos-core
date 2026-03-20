import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import {
  getWorkshopExecutionStatus,
  isWorkshopOpen,
  toWorkshopStatusBadgeClass,
} from "../utils/workshopStatus";

type BookingJob = {
  id: string;
  status: string;
  executionStatus?: string | null;
  currentEstimateStatus?: string | null;
  source?: string;
  scheduledDate: string | null;
  bikeDescription: string | null;
  notes: string | null;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  } | null;
  depositStatus?: string;
};

type DashboardResponse = {
  jobs: BookingJob[];
  summary?: {
    dueToday: number;
    overdue: number;
    byStatus: Record<string, number>;
  };
};

type DateBucket = {
  key: string;
  label: string;
  description: string;
  jobs: BookingJob[];
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

const formatCustomerName = (customer: BookingJob["customer"]) =>
  customer ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "-" : "-";

const isOpenBookingLike = (job: BookingJob) => isWorkshopOpen(job);

export const WorkshopBookingsPage = () => {
  const { error } = useToasts();
  const [jobs, setJobs] = useState<BookingJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [daysAhead, setDaysAhead] = useState("14");

  const loadBookings = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const from = formatDateKey(today);
      const to = formatDateKey(shiftDays(today, Number(daysAhead) - 1));
      const payload = await apiGet<DashboardResponse>(
        `/api/workshop/dashboard?from=${from}&to=${to}&includeCancelled=false&limit=150`,
      );
      setJobs((payload.jobs || []).filter((job) => job.scheduledDate));
    } catch (loadError) {
      setJobs([]);
      error(loadError instanceof Error ? loadError.message : "Failed to load workshop bookings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysAhead]);

  const dateBuckets = useMemo<DateBucket[]>(() => {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const soonEnd = shiftDays(todayStart, 6).getTime();
    const laterEnd = shiftDays(todayStart, Number(daysAhead) - 1).getTime();

    const buckets: DateBucket[] = [
      { key: "overdue", label: "Overdue / Unactioned", description: "Scheduled before today and still open", jobs: [] },
      { key: "today", label: "Today", description: "Bookings scheduled for today", jobs: [] },
      { key: "soon", label: "Next 7 Days", description: "Upcoming intake and appointments", jobs: [] },
      { key: "later", label: `Later In Window`, description: `Within the next ${daysAhead} days`, jobs: [] },
    ];

    for (const job of jobs) {
      if (!job.scheduledDate) {
        continue;
      }
      const scheduled = new Date(job.scheduledDate);
      const scheduledStart = new Date(scheduled.getFullYear(), scheduled.getMonth(), scheduled.getDate()).getTime();
      if (scheduledStart < todayStart.getTime() && isOpenBookingLike(job)) {
        buckets[0].jobs.push(job);
      } else if (scheduledStart === todayStart.getTime()) {
        buckets[1].jobs.push(job);
      } else if (scheduledStart <= soonEnd) {
        buckets[2].jobs.push(job);
      } else if (scheduledStart <= laterEnd) {
        buckets[3].jobs.push(job);
      }
    }

    return buckets;
  }, [daysAhead, jobs]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Bookings</h1>
            <p className="muted-text">
              Internal booking and appointment board for upcoming workshop intake. This uses existing scheduled workshop jobs and booking statuses; it is not a public booking portal.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Window
              <select value={daysAhead} onChange={(event) => setDaysAhead(event.target.value)}>
                <option value="7">Next 7 days</option>
                <option value="14">Next 14 days</option>
                <option value="30">Next 30 days</option>
              </select>
            </label>
            <Link to="/workshop">Back to workshop</Link>
            <button type="button" onClick={() => void loadBookings()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          {dateBuckets.map((bucket) => (
            <div key={bucket.key} className="metric-card">
              <span className="metric-label">{bucket.label}</span>
              <strong className="metric-value">{bucket.jobs.length}</strong>
              <span className="dashboard-metric-detail">{bucket.description}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        {dateBuckets.map((bucket) => (
          <section key={bucket.key} className="card">
            <div className="card-header-row">
              <div>
                <h2>{bucket.label}</h2>
                <p className="muted-text">{bucket.description}</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Scheduled</th>
                    <th>Customer</th>
                    <th>Bike</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Deposit</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {bucket.jobs.length === 0 ? (
                    <tr>
                      <td colSpan={7}>No bookings in this group.</td>
                    </tr>
                  ) : bucket.jobs.map((job) => (
                    <tr key={job.id}>
                      <td>{job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString() : "-"}</td>
                      <td>
                        <div className="table-primary">{formatCustomerName(job.customer)}</div>
                        <div className="table-secondary">{job.customer?.phone || job.customer?.email || "-"}</div>
                      </td>
                      <td>{job.bikeDescription || "-"}</td>
                      <td><span className={toWorkshopStatusBadgeClass(job)}>{getWorkshopExecutionStatus(job) ?? job.status}</span></td>
                      <td>{job.source || "-"}</td>
                      <td>{job.depositStatus || "-"}</td>
                      <td><Link to={`/workshop/${job.id}`}>Open job</Link></td>
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
