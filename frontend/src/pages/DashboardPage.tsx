import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useAuth } from "../auth/AuthContext";

type SalesDailyRow = {
  date: string;
  saleCount: number;
  grossPence: number;
  refundsPence: number;
  netPence: number;
};

type WorkshopDashboardResponse = {
  summary: {
    totalJobs: number;
    dueToday: number;
    overdue: number;
    byStatus: Record<string, number>;
  };
};

type ActionItem = {
  type: string;
  entityId: string;
  title: string;
  reason: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  link: string;
};

type ActionSection = {
  key: string;
  title: string;
  items: ActionItem[];
};

type ActionCentreResponse = {
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
  sections: ActionSection[];
};

type HireBookingStatus = "RESERVED" | "CHECKED_OUT" | "RETURNED" | "CANCELLED";

type HireBooking = {
  id: string;
  status: HireBookingStatus;
  startsAt: string;
  dueBackAt: string;
};

type HireBookingListResponse = {
  bookings: HireBooking[];
};

type MetricCardProps = {
  label: string;
  value: string;
  detail: string;
  href?: string;
  placeholder?: boolean;
};

type DashboardActionLink = {
  label: string;
  to?: string;
  disabledReason?: string;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatPercentDelta = (current: number, previous: number) => {
  if (previous <= 0) {
    return current > 0 ? "New" : "—";
  }

  const delta = ((current - previous) / previous) * 100;
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${delta.toFixed(0)}%`;
};

const formatDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const startOfMonth = (value: Date) => new Date(value.getFullYear(), value.getMonth(), 1);

const sumNetPence = (rows: SalesDailyRow[]) =>
  rows.reduce((total, row) => total + row.netPence, 0);

const getGreetingContext = (value: Date) => {
  const hour = value.getHours();
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 18) {
    return "Good afternoon";
  }
  return "Good evening";
};

const getFirstName = (name: string | null | undefined, username: string | undefined) => {
  const trimmed = name?.trim();
  if (trimmed) {
    return trimmed.split(/\s+/)[0] || "there";
  }
  return username || "there";
};

const isManagerPlus = (role: string | undefined) => role === "MANAGER" || role === "ADMIN";

const WORKSHOP_WAITING_STATUSES = ["BOOKING_MADE", "WAITING_FOR_APPROVAL", "WAITING_FOR_PARTS", "AWAITING_PARTS", "ON_HOLD"];
const WORKSHOP_IN_PROGRESS_STATUSES = ["BIKE_ARRIVED", "APPROVED", "IN_PROGRESS"];
const WORKSHOP_READY_STATUSES = ["BIKE_READY", "READY"];

const countStatuses = (byStatus: Record<string, number> | undefined, statuses: string[]) =>
  statuses.reduce((total, status) => total + (byStatus?.[status] ?? 0), 0);

const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());

const isSameDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate();

const actionPriority = (item: ActionItem) => {
  const haystack = `${item.title} ${item.reason}`.toLowerCase();
  if (haystack.includes("overdue")) {
    return 0;
  }
  if (
    haystack.includes("waiting")
    || haystack.includes("outstanding")
    || haystack.includes("low stock")
    || haystack.includes("pickup")
    || haystack.includes("requires action")
    || haystack.includes("requiring action")
  ) {
    return 1;
  }
  return 2;
};

const severityRank: Record<ActionItem["severity"], number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

const actionSeverityBadgeClass: Record<ActionItem["severity"], string> = {
  CRITICAL: "status-badge status-cancelled",
  WARNING: "status-badge status-warning",
  INFO: "status-badge status-info",
};

const DashboardMetricCard = ({ label, value, detail, href, placeholder = false }: MetricCardProps) => {
  const content = (
    <>
      <span className="metric-label">{label}</span>
      <strong className={`metric-value${placeholder ? " dashboard-metric-value-muted" : ""}`}>{value}</strong>
      <span className="dashboard-metric-detail">{detail}</span>
    </>
  );

  return href ? (
    <Link className="metric-card dashboard-metric-card-link" to={href}>
      {content}
    </Link>
  ) : (
    <div className="metric-card">
      {content}
    </div>
  );
};

const DashboardActionButton = ({ label, to, disabledReason }: DashboardActionLink) => {
  if (!to) {
    return (
      <span className="button-link dashboard-link-card dashboard-link-card-disabled" aria-disabled="true" title={disabledReason}>
        {label}
      </span>
    );
  }

  return (
    <Link className="button-link dashboard-link-card" to={to}>
      {label}
    </Link>
  );
};

export const DashboardPage = () => {
  const { user } = useAuth();
  const { error } = useToasts();
  const [clock, setClock] = useState(() => new Date());
  const [loading, setLoading] = useState(false);
  const [salesToday, setSalesToday] = useState<SalesDailyRow | null>(null);
  const [monthToDateNetPence, setMonthToDateNetPence] = useState<number | null>(null);
  const [lastYearMonthToDateNetPence, setLastYearMonthToDateNetPence] = useState<number | null>(null);
  const [workshopSummary, setWorkshopSummary] = useState<WorkshopDashboardResponse["summary"] | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [hireBookings, setHireBookings] = useState<HireBooking[]>([]);

  const canViewManagerWidgets = useMemo(() => isManagerPlus(user?.role), [user?.role]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const loadDashboard = async () => {
    setLoading(true);

    const today = new Date();
    const todayKey = formatDateKey(today);
    const monthStartKey = formatDateKey(startOfMonth(today));
    const lastYearToday = new Date(today);
    lastYearToday.setFullYear(today.getFullYear() - 1);
    const lastYearMonthStart = startOfMonth(lastYearToday);

    const requests = await Promise.allSettled([
      apiGet<SalesDailyRow[]>(`/api/reports/sales/daily?from=${todayKey}&to=${todayKey}`),
      apiGet<SalesDailyRow[]>(`/api/reports/sales/daily?from=${monthStartKey}&to=${todayKey}`),
      apiGet<SalesDailyRow[]>(
        `/api/reports/sales/daily?from=${formatDateKey(lastYearMonthStart)}&to=${formatDateKey(lastYearToday)}`,
      ),
      apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?limit=12"),
      canViewManagerWidgets ? apiGet<ActionCentreResponse>("/api/reports/operations/actions") : Promise.resolve(null),
      canViewManagerWidgets ? apiGet<HireBookingListResponse>("/api/hire/bookings?take=200") : Promise.resolve(null),
    ]);

    const [salesTodayResult, monthResult, lastYearResult, workshopResult, actionResult, hireResult] = requests;

    if (salesTodayResult.status === "fulfilled") {
      setSalesToday(
        salesTodayResult.value[0] ?? {
          date: todayKey,
          saleCount: 0,
          grossPence: 0,
          refundsPence: 0,
          netPence: 0,
        },
      );
    } else {
      setSalesToday(null);
      error(salesTodayResult.reason instanceof Error ? salesTodayResult.reason.message : "Failed to load today’s sales");
    }

    if (monthResult.status === "fulfilled") {
      setMonthToDateNetPence(sumNetPence(monthResult.value));
    } else {
      setMonthToDateNetPence(null);
      error(monthResult.reason instanceof Error ? monthResult.reason.message : "Failed to load month-to-date sales");
    }

    if (lastYearResult.status === "fulfilled") {
      setLastYearMonthToDateNetPence(sumNetPence(lastYearResult.value));
    } else {
      setLastYearMonthToDateNetPence(null);
      error(lastYearResult.reason instanceof Error ? lastYearResult.reason.message : "Failed to load last year comparison");
    }

    if (workshopResult.status === "fulfilled") {
      setWorkshopSummary(workshopResult.value.summary);
    } else {
      setWorkshopSummary(null);
      error(workshopResult.reason instanceof Error ? workshopResult.reason.message : "Failed to load workshop snapshot");
    }

    if (actionResult.status === "fulfilled" && actionResult.value) {
      const flattened = (actionResult.value.sections ?? []).flatMap((section) =>
        section.items.map((item) => ({
          ...item,
          title: item.title || section.title,
        })),
      );
      flattened.sort((left, right) => {
        const priorityDelta = actionPriority(left) - actionPriority(right);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }
        const severityDelta = severityRank[left.severity] - severityRank[right.severity];
        if (severityDelta !== 0) {
          return severityDelta;
        }
        return left.title.localeCompare(right.title);
      });
      setActionItems(flattened.slice(0, 6));
    } else if (actionResult.status === "rejected") {
      setActionItems([]);
      error(actionResult.reason instanceof Error ? actionResult.reason.message : "Failed to load action centre");
    } else {
      setActionItems([]);
    }

    if (hireResult.status === "fulfilled" && hireResult.value) {
      setHireBookings(hireResult.value.bookings ?? []);
    } else if (hireResult.status === "rejected") {
      setHireBookings([]);
      error(hireResult.reason instanceof Error ? hireResult.reason.message : "Failed to load rentals snapshot");
    } else {
      setHireBookings([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewManagerWidgets]);

  const firstName = useMemo(() => getFirstName(user?.name, user?.username), [user?.name, user?.username]);
  const headerDateLabel = useMemo(
    () => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(clock),
    [clock],
  );
  const headerTimeLabel = useMemo(
    () => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(clock),
    [clock],
  );
  const headerGreetingContext = useMemo(() => getGreetingContext(clock), [clock]);

  const outstandingWorkshopJobs = useMemo(() => {
    if (!workshopSummary) {
      return null;
    }
    return countStatuses(workshopSummary.byStatus, [
      ...WORKSHOP_WAITING_STATUSES,
      ...WORKSHOP_IN_PROGRESS_STATUSES,
      ...WORKSHOP_READY_STATUSES,
    ]);
  }, [workshopSummary]);

  const workshopWaitingCount = useMemo(
    () => countStatuses(workshopSummary?.byStatus, WORKSHOP_WAITING_STATUSES),
    [workshopSummary],
  );
  const workshopInProgressCount = useMemo(
    () => countStatuses(workshopSummary?.byStatus, WORKSHOP_IN_PROGRESS_STATUSES),
    [workshopSummary],
  );
  const workshopReadyCount = useMemo(
    () => countStatuses(workshopSummary?.byStatus, WORKSHOP_READY_STATUSES),
    [workshopSummary],
  );

  const monthDeltaLabel = useMemo(() => {
    if (monthToDateNetPence === null || lastYearMonthToDateNetPence === null) {
      return "—";
    }
    return formatPercentDelta(monthToDateNetPence, lastYearMonthToDateNetPence);
  }, [lastYearMonthToDateNetPence, monthToDateNetPence]);

  const rentalSnapshot = useMemo(() => {
    const now = new Date();
    const today = startOfDay(now);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const summary = {
      pickupsToday: 0,
      pickupsTomorrow: 0,
      returnsToday: 0,
      returnsTomorrow: 0,
      overdue: 0,
    };

    for (const booking of hireBookings) {
      if (booking.status === "CANCELLED" || booking.status === "RETURNED") {
        continue;
      }

      const start = new Date(booking.startsAt);
      const due = new Date(booking.dueBackAt);

      if (booking.status === "RESERVED" && isSameDay(start, today)) {
        summary.pickupsToday += 1;
      }
      if (booking.status === "RESERVED" && isSameDay(start, tomorrow)) {
        summary.pickupsTomorrow += 1;
      }
      if (booking.status === "CHECKED_OUT" && isSameDay(due, today)) {
        summary.returnsToday += 1;
      }
      if (booking.status === "CHECKED_OUT" && isSameDay(due, tomorrow)) {
        summary.returnsTomorrow += 1;
      }
      if (booking.status === "CHECKED_OUT" && due.getTime() < now.getTime()) {
        summary.overdue += 1;
      }
    }

    return summary;
  }, [hireBookings]);

  const quickActions = useMemo<DashboardActionLink[]>(() => {
    const rotaLink = user?.role === "ADMIN"
      ? "/settings/staff-rota"
      : user?.role === "MANAGER"
        ? "/management/calendar"
        : undefined;

    return [
      { label: "New Sale", to: "/pos" },
      { label: "New Workshop Job", to: "/workshop/check-in" },
      { label: "Customer Search", to: "/customers" },
      {
        label: "View Rota",
        ...(rotaLink ? { to: rotaLink } : { disabledReason: "Rota view is not available for this role yet." }),
      },
    ];
  }, [user?.role]);

  return (
    <div className="page-shell dashboard-v1">
      <section className="card dashboard-v1-header">
        <div className="dashboard-v1-header-main">
          <div>
            <p className="dashboard-v1-kicker">Operational Control Centre</p>
            <h1>Hello {firstName}</h1>
            <p className="muted-text">
              {headerDateLabel} · {headerGreetingContext} · {headerTimeLabel}
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadDashboard()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh dashboard"}
            </button>
          </div>
        </div>
        <div className="dashboard-link-grid">
          {quickActions.map((action) => (
            <DashboardActionButton key={action.label} {...action} />
          ))}
        </div>
      </section>

      <section className="dashboard-summary-grid dashboard-v1-kpis">
        <DashboardMetricCard
          label="Monthly Margin"
          value="—"
          detail="Awaiting a dedicated cost-aware margin feed for dashboard use."
          href={canViewManagerWidgets ? "/management/pricing" : undefined}
          placeholder
        />
        <DashboardMetricCard
          label="vs Last Year"
          value={monthDeltaLabel}
          detail="Month-to-date net sales versus the same period last year."
          href={canViewManagerWidgets ? "/management/sales" : undefined}
          placeholder={monthToDateNetPence === null || lastYearMonthToDateNetPence === null}
        />
        <DashboardMetricCard
          label="Sales Today"
          value={salesToday ? formatMoney(salesToday.netPence) : "—"}
          detail={salesToday ? `Gross ${formatMoney(salesToday.grossPence)} · Refunds ${formatMoney(salesToday.refundsPence)}` : "Today’s sales feed is unavailable."}
          href="/pos"
          placeholder={!salesToday}
        />
        <DashboardMetricCard
          label="Transactions Today"
          value={salesToday ? `${salesToday.saleCount}` : "—"}
          detail="Completed sales counted for today."
          href="/sales-history/transactions"
          placeholder={!salesToday}
        />
        <DashboardMetricCard
          label="Outstanding Workshop Jobs"
          value={outstandingWorkshopJobs === null ? "—" : `${outstandingWorkshopJobs}`}
          detail={`Due today ${workshopSummary?.dueToday ?? 0} · Overdue ${workshopSummary?.overdue ?? 0}`}
          href="/workshop"
          placeholder={!workshopSummary}
        />
      </section>

      <div className="dashboard-v1-main-row">
        <section className="card dashboard-v1-widget dashboard-v1-action-centre">
          <div className="card-header-row">
            <div>
              <h2>Action Centre</h2>
              <p className="muted-text">Top operational alerts only. Open the linked area to resolve the issue.</p>
            </div>
            {canViewManagerWidgets ? <Link to="/management/actions">Open full queue</Link> : null}
          </div>

          {canViewManagerWidgets ? (
            actionItems.length ? (
              <div className="dashboard-action-list">
                {actionItems.map((item) => (
                  <Link key={`${item.type}-${item.entityId}`} className="dashboard-action-item" to={item.link}>
                    <div className="dashboard-action-copy">
                      <strong>{item.title}</strong>
                      <span className="muted-text">{item.reason}</span>
                    </div>
                    <span className={actionSeverityBadgeClass[item.severity]}>{item.severity}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="restricted-panel info-panel">
                No operational alerts need action right now. Open the full action centre if you still want to review grouped manager queues.
              </div>
            )
          ) : (
            <div className="restricted-panel info-panel">
              Action Centre is available to managers. Staff can jump directly into POS, workshop, customers, and inventory from the quick actions above.
            </div>
          )}
        </section>

        <section className="card dashboard-v1-widget">
          <div className="card-header-row">
            <div>
              <h2>Workshop Snapshot</h2>
              <p className="muted-text">A fast count of jobs waiting, active, and ready for pickup.</p>
            </div>
            <div className="actions-inline">
              <Link to="/workshop">Job Board</Link>
              <Link to="/workshop/collection">Collection</Link>
            </div>
          </div>

          <div className="dashboard-v1-stat-grid">
            <div className="dashboard-v1-stat-card">
              <span className="metric-label">Waiting</span>
              <strong className="metric-value">{workshopSummary ? workshopWaitingCount : "—"}</strong>
              <span className="dashboard-metric-detail">Jobs waiting for approval, parts, or scheduling decisions.</span>
            </div>
            <div className="dashboard-v1-stat-card">
              <span className="metric-label">In Progress</span>
              <strong className="metric-value">{workshopSummary ? workshopInProgressCount : "—"}</strong>
              <span className="dashboard-metric-detail">Active bench work already underway.</span>
            </div>
            <div className="dashboard-v1-stat-card">
              <span className="metric-label">Ready for Pickup</span>
              <strong className="metric-value">{workshopSummary ? workshopReadyCount : "—"}</strong>
              <span className="dashboard-metric-detail">Completed jobs ready for customer handover.</span>
            </div>
          </div>
        </section>

        <section className="card dashboard-v1-widget">
          <div className="card-header-row">
            <div>
              <h2>Rentals</h2>
              <p className="muted-text">Today and tomorrow’s hire desk handoffs without opening the full rental workspace.</p>
            </div>
            {canViewManagerWidgets ? <Link to="/rental/calendar">Rental Calendar</Link> : null}
          </div>

          {canViewManagerWidgets ? (
            <div className="dashboard-v1-stat-grid">
              <div className="dashboard-v1-stat-card">
                <span className="metric-label">Pickups Today</span>
                <strong className="metric-value">{rentalSnapshot.pickupsToday}</strong>
                <span className="dashboard-metric-detail">Reserved bikes due out today.</span>
              </div>
              <div className="dashboard-v1-stat-card">
                <span className="metric-label">Pickups Tomorrow</span>
                <strong className="metric-value">{rentalSnapshot.pickupsTomorrow}</strong>
                <span className="dashboard-metric-detail">Reserved bikes due out tomorrow.</span>
              </div>
              <div className="dashboard-v1-stat-card">
                <span className="metric-label">Returns Today</span>
                <strong className="metric-value">{rentalSnapshot.returnsToday}</strong>
                <span className="dashboard-metric-detail">Checked-out bikes expected back today.</span>
              </div>
              <div className="dashboard-v1-stat-card">
                <span className="metric-label">Returns Tomorrow</span>
                <strong className="metric-value">{rentalSnapshot.returnsTomorrow}</strong>
                <span className="dashboard-metric-detail">Checked-out bikes expected back tomorrow.</span>
              </div>
              <div className="dashboard-v1-stat-card">
                <span className="metric-label">Overdue</span>
                <strong className="metric-value">{rentalSnapshot.overdue}</strong>
                <span className="dashboard-metric-detail">Checked-out rentals already past due back time.</span>
              </div>
            </div>
          ) : (
            <div className="restricted-panel info-panel">
              Rental operations are configured for manager access only on this deployment. The widget remains in place so the dashboard structure is consistent when rental access is enabled.
            </div>
          )}
        </section>
      </div>

      <div className="dashboard-v1-lower-row">
        <section className="card dashboard-v1-widget">
          <div className="card-header-row">
            <div>
              <h2>Staff Today</h2>
              <p className="muted-text">Today’s team coverage will live here once rota data is connected to the dashboard.</p>
            </div>
            {quickActions.find((action) => action.label === "View Rota")?.to ? (
              <Link to={quickActions.find((action) => action.label === "View Rota")?.to ?? "/dashboard"}>View Rota</Link>
            ) : null}
          </div>

          <div className="restricted-panel info-panel">
            <strong>Signed in now:</strong> {user?.name?.trim() || user?.username || "Current user"}
            <div className="muted-text">Staff rota data is not yet wired to the dashboard, so use the rota/calendar destination for the planned workspace.</div>
          </div>
        </section>

        <section className="card dashboard-v1-widget">
          <div className="card-header-row">
            <div>
              <h2>Weather</h2>
              <p className="muted-text">Today’s forecast will appear here when a weather feed is connected.</p>
            </div>
          </div>

          <div className="restricted-panel info-panel">
            Weather is intentionally shown as a clean placeholder in Dashboard v1. The widget is ready for a real forecast feed without changing the overall dashboard layout.
          </div>
        </section>
      </div>
    </div>
  );
};
