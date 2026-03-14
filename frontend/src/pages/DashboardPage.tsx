import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useAuth } from "../auth/AuthContext";
import { HolidayRequestModal } from "../components/HolidayRequestModal";
import { HolidayRequestsPanel, type HolidayRequestItem } from "../components/HolidayRequestsPanel";

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

type DashboardWeatherSnapshot = {
  summary: string;
  highC: number;
  lowC: number;
  precipitationMm: number;
};

type DashboardWeatherPayload = {
  weather: {
    status: "ready" | "missing_location" | "unavailable";
    source: "open-meteo";
    locationLabel?: string;
    message?: string;
    today?: DashboardWeatherSnapshot;
    tomorrow?: DashboardWeatherSnapshot;
  };
};

type DashboardStaffTodayPayload = {
  staffToday: {
    summary: {
      date: string;
      isClosed: boolean;
      closedReason: string | null;
      opensAt: string | null;
      closesAt: string | null;
      scheduledStaffCount: number;
      holidayStaffCount: number;
    };
    staff: Array<{
      staffId: string;
      name: string;
      role: "STAFF" | "MANAGER" | "ADMIN";
      shiftType: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOLIDAY";
      note: string | null;
      source: "MANUAL" | "IMPORT";
    }>;
  };
};

type HolidayRequestsPayload = {
  scope: "mine" | "all";
  requests: HolidayRequestItem[];
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
  emphasize?: boolean;
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

const actionIconLabel = (item: ActionItem) => {
  const haystack = `${item.type} ${item.title} ${item.reason}`.toLowerCase();

  if (haystack.includes("overdue")) {
    return { glyph: "!", label: "Overdue alert", tone: "critical" };
  }
  if (haystack.includes("pickup") || haystack.includes("ready")) {
    return { glyph: "↗", label: "Ready for collection", tone: "ready" };
  }
  if (haystack.includes("outstanding") || haystack.includes("waiting") || haystack.includes("stock")) {
    return { glyph: "•", label: "Needs attention", tone: "warning" };
  }

  return { glyph: "i", label: "Operational information", tone: "info" };
};

const DashboardMetricCard = ({ label, value, detail, href, placeholder = false }: MetricCardProps) => {
  const content = (
    <>
      <span className="metric-label dashboard-metric-label">{label}</span>
      <strong className={`metric-value dashboard-metric-value${placeholder ? " dashboard-metric-value-muted" : ""}`}>{value}</strong>
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

const DashboardActionButton = ({ label, to, disabledReason, emphasize = false }: DashboardActionLink) => {
  const className = `button-link dashboard-link-card${emphasize ? " dashboard-link-card-primary" : ""}`;

  if (!to) {
    return (
      <span className={`${className} dashboard-link-card-disabled`} aria-disabled="true" title={disabledReason}>
        {label}
      </span>
    );
  }

  return (
    <Link className={className} to={to}>
      {label}
    </Link>
  );
};

export const DashboardPage = () => {
  const { user } = useAuth();
  const { error, success } = useToasts();
  const [clock, setClock] = useState(() => new Date());
  const [loading, setLoading] = useState(false);
  const [salesToday, setSalesToday] = useState<SalesDailyRow | null>(null);
  const [monthToDateNetPence, setMonthToDateNetPence] = useState<number | null>(null);
  const [lastYearMonthToDateNetPence, setLastYearMonthToDateNetPence] = useState<number | null>(null);
  const [workshopSummary, setWorkshopSummary] = useState<WorkshopDashboardResponse["summary"] | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [hireBookings, setHireBookings] = useState<HireBooking[]>([]);
  const [weather, setWeather] = useState<DashboardWeatherPayload["weather"] | null>(null);
  const [staffToday, setStaffToday] = useState<DashboardStaffTodayPayload["staffToday"] | null>(null);
  const [holidayRequests, setHolidayRequests] = useState<HolidayRequestItem[]>([]);
  const [holidayRequestModalOpen, setHolidayRequestModalOpen] = useState(false);
  const [holidayRequestSubmitting, setHolidayRequestSubmitting] = useState(false);
  const [holidayRequestBusyId, setHolidayRequestBusyId] = useState<string | null>(null);

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
      apiGet<DashboardStaffTodayPayload>("/api/dashboard/staff-today"),
      apiGet<DashboardWeatherPayload>("/api/dashboard/weather"),
      apiGet<HolidayRequestsPayload>("/api/rota/holiday-requests?scope=mine"),
    ]);

    const [
      salesTodayResult,
      monthResult,
      lastYearResult,
      workshopResult,
      actionResult,
      hireResult,
      staffTodayResult,
      weatherResult,
      holidayRequestsResult,
    ] = requests;

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

    if (staffTodayResult.status === "fulfilled" && staffTodayResult.value) {
      setStaffToday(staffTodayResult.value.staffToday);
    } else {
      setStaffToday(null);
    }

    if (weatherResult.status === "fulfilled" && weatherResult.value) {
      setWeather(weatherResult.value.weather);
    } else {
      setWeather({
        status: "unavailable",
        source: "open-meteo",
        message: "Weather temporarily unavailable.",
      });
    }

    if (holidayRequestsResult.status === "fulfilled" && holidayRequestsResult.value) {
      setHolidayRequests(holidayRequestsResult.value.requests ?? []);
    } else {
      setHolidayRequests([]);
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
        ? "/management/staff-rota"
        : undefined;

    return [
      { label: "New Sale", to: "/pos", emphasize: true },
      { label: "New Workshop Job", to: "/workshop/check-in" },
      { label: "Customer Search", to: "/customers" },
      {
        label: "View Rota",
        ...(rotaLink ? { to: rotaLink } : { disabledReason: "Rota view is not available for this role yet." }),
      },
    ];
  }, [user?.role]);

  const dashboardActionItems = useMemo<ActionItem[]>(() => {
    const items: ActionItem[] = [];

    if (workshopSummary?.overdue) {
      items.push({
        type: "OVERDUE_WORKSHOP_JOBS",
        entityId: "dashboard-overdue-workshop-jobs",
        title: "Overdue workshop jobs",
        reason: `${workshopSummary.overdue} workshop job${workshopSummary.overdue === 1 ? "" : "s"} overdue and needing attention.`,
        severity: "CRITICAL",
        link: "/workshop",
      });
    }

    if (outstandingWorkshopJobs) {
      items.push({
        type: "OUTSTANDING_WORKSHOP_JOBS",
        entityId: "dashboard-outstanding-workshop-jobs",
        title: "Outstanding workshop jobs",
        reason: `${outstandingWorkshopJobs} open workshop job${outstandingWorkshopJobs === 1 ? "" : "s"} still moving through the queue.`,
        severity: workshopWaitingCount > 0 ? "WARNING" : "INFO",
        link: "/workshop",
      });
    }

    if (workshopReadyCount) {
      items.push({
        type: "JOBS_READY_FOR_PICKUP",
        entityId: "dashboard-ready-for-pickup",
        title: "Jobs ready for pickup",
        reason: `${workshopReadyCount} bike${workshopReadyCount === 1 ? "" : "s"} waiting for customer collection.`,
        severity: "WARNING",
        link: "/workshop/collection",
      });
    }

    if (rentalSnapshot.overdue) {
      items.push({
        type: "OVERDUE_RENTALS",
        entityId: "dashboard-overdue-rentals",
        title: "Overdue rentals",
        reason: `${rentalSnapshot.overdue} hire booking${rentalSnapshot.overdue === 1 ? "" : "s"} overdue for return.`,
        severity: "WARNING",
        link: "/rental/returns",
      });
    }

    items.push(...actionItems.filter((item) => item.type === "OVERDUE_PURCHASE_ORDER"));

    return items
      .sort((left, right) => {
        const priorityDelta = actionPriority(left) - actionPriority(right);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }
        const severityDelta = severityRank[left.severity] - severityRank[right.severity];
        if (severityDelta !== 0) {
          return severityDelta;
        }
        return left.title.localeCompare(right.title);
      })
      .slice(0, 6);
  }, [
    actionItems,
    outstandingWorkshopJobs,
    rentalSnapshot.overdue,
    workshopReadyCount,
    workshopSummary?.overdue,
    workshopWaitingCount,
  ]);

  const staffTodayWindow = useMemo(() => {
    if (!staffToday?.summary || staffToday.summary.isClosed) {
      return null;
    }
    if (!staffToday.summary.opensAt || !staffToday.summary.closesAt) {
      return null;
    }
    return `${staffToday.summary.opensAt} - ${staffToday.summary.closesAt}`;
  }, [staffToday]);

  const visibleHolidayRequests = useMemo(() => holidayRequests.slice(0, 4), [holidayRequests]);

  const submitHolidayRequest = async (values: {
    startDate: string;
    endDate: string;
    requestNotes: string;
  }) => {
    setHolidayRequestSubmitting(true);
    try {
      await apiPost("/api/rota/holiday-requests", values);
      success("Holiday request submitted.");
      setHolidayRequestModalOpen(false);
      await loadDashboard();
    } catch (submitError) {
      error(submitError instanceof Error ? submitError.message : "Failed to submit holiday request");
    } finally {
      setHolidayRequestSubmitting(false);
    }
  };

  const cancelHolidayRequest = async (requestId: string) => {
    setHolidayRequestBusyId(requestId);
    try {
      await apiPost(`/api/rota/holiday-requests/${encodeURIComponent(requestId)}/cancel`);
      success("Holiday request cancelled.");
      await loadDashboard();
    } catch (cancelError) {
      error(cancelError instanceof Error ? cancelError.message : "Failed to cancel holiday request");
    } finally {
      setHolidayRequestBusyId(null);
    }
  };

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
            dashboardActionItems.length ? (
              <div className="dashboard-action-list">
                {dashboardActionItems.map((item) => {
                  const icon = actionIconLabel(item);

                  return (
                    <Link key={`${item.type}-${item.entityId}`} className="dashboard-action-item" to={item.link}>
                      <span
                        className={`dashboard-action-icon dashboard-action-icon--${icon.tone}`}
                        aria-hidden="true"
                        title={icon.label}
                      >
                        {icon.glyph}
                      </span>
                      <div className="dashboard-action-copy">
                        <strong>{item.title}</strong>
                        <span className="muted-text">{item.reason}</span>
                      </div>
                      <span className={actionSeverityBadgeClass[item.severity]}>{item.severity}</span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="restricted-panel info-panel">
                No operational alerts need action right now. The full management action centre still holds broader grouped oversight queues outside this dashboard.
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
              <span className="metric-label dashboard-metric-label">Waiting</span>
              <strong className="metric-value">{workshopSummary ? workshopWaitingCount : "—"}</strong>
              <span className="dashboard-metric-detail">Jobs waiting for approval, parts, or scheduling decisions.</span>
            </div>
            <div className="dashboard-v1-stat-card">
              <span className="metric-label dashboard-metric-label">In Progress</span>
              <strong className="metric-value">{workshopSummary ? workshopInProgressCount : "—"}</strong>
              <span className="dashboard-metric-detail">Active bench work already underway.</span>
            </div>
            <div className="dashboard-v1-stat-card">
              <span className="metric-label dashboard-metric-label">Ready for Pickup</span>
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
                <span className="metric-label dashboard-metric-label">Pickups Today</span>
                <strong className="metric-value">{rentalSnapshot.pickupsToday}</strong>
                <span className="dashboard-metric-detail">Reserved bikes due out today.</span>
              </div>
              <div className="dashboard-v1-stat-card">
                <span className="metric-label dashboard-metric-label">Pickups Tomorrow</span>
                <strong className="metric-value">{rentalSnapshot.pickupsTomorrow}</strong>
                <span className="dashboard-metric-detail">Reserved bikes due out tomorrow.</span>
              </div>
              <div className="dashboard-v1-stat-card">
                <span className="metric-label dashboard-metric-label">Returns Today</span>
                <strong className="metric-value">{rentalSnapshot.returnsToday}</strong>
                <span className="dashboard-metric-detail">Checked-out bikes expected back today.</span>
              </div>
              <div className="dashboard-v1-stat-card">
                <span className="metric-label dashboard-metric-label">Returns Tomorrow</span>
                <strong className="metric-value">{rentalSnapshot.returnsTomorrow}</strong>
                <span className="dashboard-metric-detail">Checked-out bikes expected back tomorrow.</span>
              </div>
              <div className="dashboard-v1-stat-card">
                <span className="metric-label dashboard-metric-label">Overdue</span>
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
              <p className="muted-text">Today’s rota coverage from imported schedule data and Store Info opening hours.</p>
            </div>
            <div className="actions-inline">
              <button type="button" onClick={() => setHolidayRequestModalOpen(true)}>Request Holiday</button>
              {quickActions.find((action) => action.label === "View Rota")?.to ? (
                <Link to={quickActions.find((action) => action.label === "View Rota")?.to ?? "/dashboard"}>View Rota</Link>
              ) : null}
            </div>
          </div>

          {!staffToday ? (
            <div className="restricted-panel info-panel">Loading today&apos;s rota...</div>
          ) : staffToday.summary.isClosed ? (
            <div className="restricted-panel info-panel">
              <strong>Store closed today.</strong>
              <div className="muted-text">{staffToday.summary.closedReason || "No scheduled trading hours today."}</div>
            </div>
          ) : staffToday.staff.length ? (
            <div className="dashboard-action-list">
              {staffToday.staff.map((entry) => (
                <div key={`${entry.staffId}-${entry.shiftType}`} className="dashboard-action-item">
                  <div className="dashboard-action-copy">
                    <strong>{entry.name}</strong>
                    <span className="muted-text">
                      {entry.shiftType === "FULL_DAY" ? "Full day" : entry.shiftType === "HALF_DAY_AM" ? "Half day (AM)" : "Half day (PM)"}
                      {entry.note ? ` · ${entry.note}` : ""}
                    </span>
                  </div>
                  <span className="status-badge status-info">{entry.role}</span>
                </div>
              ))}
              <div className="restricted-panel info-panel">
                {staffToday.summary.scheduledStaffCount} scheduled
                {staffTodayWindow ? ` · ${staffTodayWindow}` : ""}
                {staffToday.summary.holidayStaffCount ? ` · ${staffToday.summary.holidayStaffCount} on holiday` : ""}
              </div>
            </div>
          ) : (
            <div className="restricted-panel info-panel">
              <strong>No staff scheduled today.</strong>
              <div className="muted-text">
                {staffToday.summary.holidayStaffCount
                  ? `${staffToday.summary.holidayStaffCount} on holiday${staffTodayWindow ? ` · Trading hours ${staffTodayWindow}.` : ""}`
                  : staffTodayWindow ? `Trading hours ${staffTodayWindow}.` : "Trading hours available in Store Info."}
              </div>
            </div>
          )}

          <HolidayRequestsPanel
            title="My Holiday Requests"
            subtitle="Submit simple rota holiday requests and track approval status."
            requests={visibleHolidayRequests}
            loading={loading && holidayRequests.length === 0}
            requestButtonLabel="Request holiday"
            onRequestHoliday={() => setHolidayRequestModalOpen(true)}
            onCancel={cancelHolidayRequest}
            busyRequestId={holidayRequestBusyId}
            emptyMessage="No holiday requests submitted yet."
          />
        </section>

        <section className="card dashboard-v1-widget">
          <div className="card-header-row">
            <div>
              <h2>Weather</h2>
              <p className="muted-text">A compact forecast for today, based on the store postcode in Store Info.</p>
            </div>
          </div>

          {!weather ? (
            <div className="restricted-panel info-panel">Loading weather...</div>
          ) : weather.status === "ready" && weather.today ? (
            <div className="dashboard-weather-card">
              <div className="dashboard-weather-headline">
                <div>
                  <span className="metric-label dashboard-metric-label">Today</span>
                  <strong className="dashboard-weather-summary">{weather.today.summary}</strong>
                </div>
                <div className="dashboard-weather-temps">
                  <strong>{weather.today.highC}°</strong>
                  <span>{weather.today.lowC}°</span>
                </div>
              </div>
              <div className="dashboard-weather-meta">
                <span>Rain {weather.today.precipitationMm} mm</span>
                {weather.locationLabel ? <span>{weather.locationLabel}</span> : null}
              </div>
              {weather.tomorrow ? (
                <div className="dashboard-weather-tomorrow">
                  <span className="metric-label dashboard-metric-label">Tomorrow</span>
                  <strong>{weather.tomorrow.summary}</strong>
                  <span>
                    {weather.tomorrow.highC}° / {weather.tomorrow.lowC}° · Rain {weather.tomorrow.precipitationMm} mm
                  </span>
                </div>
              ) : null}
            </div>
          ) : weather.status === "missing_location" ? (
            <div className="restricted-panel info-panel">
              {user?.role === "ADMIN" ? (
                <>
                  Weather unavailable. Set the store postcode in <Link to="/settings/store-info">Settings</Link>.
                </>
              ) : (
                "Weather unavailable. Ask an admin to set the store postcode in Settings."
              )}
            </div>
          ) : (
            <div className="restricted-panel info-panel">
              {weather.message || "Weather temporarily unavailable."}
            </div>
          )}
        </section>
      </div>

      <HolidayRequestModal
        open={holidayRequestModalOpen}
        submitting={holidayRequestSubmitting}
        onClose={() => {
          if (!holidayRequestSubmitting) {
            setHolidayRequestModalOpen(false);
          }
        }}
        onSubmit={submitHolidayRequest}
      />
    </div>
  );
};
