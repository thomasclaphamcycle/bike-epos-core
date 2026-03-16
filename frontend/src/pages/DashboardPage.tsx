import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import {
  getFinancialMonthlyMarginReport,
  getFinancialMonthlySalesSummaryReport,
  type FinancialMonthlyMarginReport,
  type FinancialMonthlySalesSummaryReport,
} from "../api/financialReports";
import { useToasts } from "../components/ToastProvider";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { EmptyState } from "../components/ui/EmptyState";

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

type DashboardWeatherTimelinePoint = {
  time: string;
  label: string;
  summary: string;
  kind: "sun" | "part-sun" | "cloud" | "rain" | "showers";
  temperatureC: number;
  precipitationMm: number;
  precipitationProbabilityPercent: number;
};

type DashboardWeatherPayload = {
  weather: {
    status: "ready" | "missing_location" | "unavailable";
    source: "open-meteo";
    locationLabel?: string;
    message?: string;
    today?: DashboardWeatherSnapshot;
    tomorrow?: DashboardWeatherSnapshot;
    tradingDayTimeline?: DashboardWeatherTimelinePoint[];
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
    holidayStaff?: Array<{
      staffId: string;
      name: string;
      role: "STAFF" | "MANAGER" | "ADMIN";
      shiftType: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOLIDAY";
      note: string | null;
      source: "MANUAL" | "IMPORT";
    }>;
  };
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
const formatDashboardCurrency = (valueGbp: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(valueGbp);
const formatDashboardCurrencyFromPence = (valuePence: number) => formatDashboardCurrency(valuePence / 100);

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

const getShiftBadgeLabel = (shiftType: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOLIDAY") => {
  switch (shiftType) {
    case "HALF_DAY_AM":
      return "AM";
    case "HALF_DAY_PM":
      return "PM";
    case "HOLIDAY":
      return "Holiday";
    default:
      return "FULL";
  }
};

const weatherGlyph: Record<DashboardWeatherTimelinePoint["kind"], string> = {
  sun: "☀",
  "part-sun": "⛅",
  cloud: "☁",
  rain: "☂",
  showers: "☔",
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
    <Link className="metric-card dashboard-metric-card dashboard-metric-card-link" to={href}>
      {content}
    </Link>
  ) : (
    <div className="metric-card dashboard-metric-card">
      {content}
    </div>
  );
};

type DashboardStatCardProps = {
  label: string;
  value: string | number;
  detail: string;
};

const DashboardStatCard = ({ label, value, detail }: DashboardStatCardProps) => (
  <div className="dashboard-v1-stat-card">
    <span className="metric-label dashboard-metric-label">{label}</span>
    <strong className="metric-value">{value}</strong>
    <span className="dashboard-metric-detail">{detail}</span>
  </div>
);

const DashboardActionButton = ({ label, to, disabledReason }: DashboardActionLink) => {
  const className = "button-link dashboard-link-card";

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

const buildMonthlyMarginTileDetail = (report: FinancialMonthlyMarginReport) => {
  const parts = [
    `Revenue ${formatDashboardCurrencyFromPence(report.summary.revenuePence)}`,
    `Cost ${formatDashboardCurrencyFromPence(report.summary.cogsPence)}`,
    `${report.summary.grossMarginPercent.toFixed(1)}% margin`,
  ];

  if (report.costBasis.revenueWithoutCostBasisPence > 0) {
    parts.push(`${report.costBasis.knownCostCoveragePercent.toFixed(1)}% cost coverage`);
  }

  return parts.join(" · ");
};

const buildMonthlySalesTileDetail = (report: FinancialMonthlySalesSummaryReport) => {
  const parts = [
    `${report.summary.transactions} transaction${report.summary.transactions === 1 ? "" : "s"}`,
    `Avg ${formatDashboardCurrencyFromPence(report.summary.averageSaleValuePence)}`,
  ];

  if (report.summary.refundsPence > 0) {
    parts.push(`Refunds ${formatDashboardCurrencyFromPence(report.summary.refundsPence)}`);
  }

  return parts.join(" · ");
};

export const DashboardPage = () => {
  const { user } = useAuth();
  const { error } = useToasts();
  const [clock, setClock] = useState(() => new Date());
  const [loading, setLoading] = useState(false);
  const [salesToday, setSalesToday] = useState<SalesDailyRow | null>(null);
  const [monthToDateNetPence, setMonthToDateNetPence] = useState<number | null>(null);
  const [lastYearMonthToDateNetPence, setLastYearMonthToDateNetPence] = useState<number | null>(null);
  const [monthlyMarginReport, setMonthlyMarginReport] = useState<FinancialMonthlyMarginReport | null>(null);
  const [monthlySalesReport, setMonthlySalesReport] = useState<FinancialMonthlySalesSummaryReport | null>(null);
  const [workshopSummary, setWorkshopSummary] = useState<WorkshopDashboardResponse["summary"] | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [hireBookings, setHireBookings] = useState<HireBooking[]>([]);
  const [weather, setWeather] = useState<DashboardWeatherPayload["weather"] | null>(null);
  const [staffToday, setStaffToday] = useState<DashboardStaffTodayPayload["staffToday"] | null>(null);
  const [staffTomorrow, setStaffTomorrow] = useState<DashboardStaffTodayPayload["staffToday"] | null>(null);

  const canViewManagerWidgets = useMemo(() => isManagerPlus(user?.role), [user?.role]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const loadDashboard = async () => {
    setLoading(true);

    const today = new Date();
    const todayKey = formatDateKey(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowKey = formatDateKey(tomorrow);
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
      canViewManagerWidgets ? getFinancialMonthlyMarginReport() : Promise.resolve(null),
      canViewManagerWidgets ? getFinancialMonthlySalesSummaryReport() : Promise.resolve(null),
      canViewManagerWidgets ? apiGet<ActionCentreResponse>("/api/reports/operations/actions") : Promise.resolve(null),
      canViewManagerWidgets ? apiGet<HireBookingListResponse>("/api/hire/bookings?take=200") : Promise.resolve(null),
      apiGet<DashboardStaffTodayPayload>("/api/dashboard/staff-today"),
      apiGet<DashboardStaffTodayPayload>(`/api/dashboard/staff-today?date=${tomorrowKey}`),
      apiGet<DashboardWeatherPayload>("/api/dashboard/weather"),
    ]);

    const [
      salesTodayResult,
      monthResult,
      lastYearResult,
      workshopResult,
      monthlyMarginResult,
      monthlySalesResult,
      actionResult,
      hireResult,
      staffTodayResult,
      staffTomorrowResult,
      weatherResult,
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

    if (monthlyMarginResult.status === "fulfilled") {
      setMonthlyMarginReport(monthlyMarginResult.value);
    } else if (monthlyMarginResult.status === "rejected") {
      setMonthlyMarginReport(null);
      error(monthlyMarginResult.reason instanceof Error ? monthlyMarginResult.reason.message : "Failed to load monthly margin");
    } else {
      setMonthlyMarginReport(null);
    }

    if (monthlySalesResult.status === "fulfilled") {
      setMonthlySalesReport(monthlySalesResult.value);
    } else if (monthlySalesResult.status === "rejected") {
      setMonthlySalesReport(null);
      error(monthlySalesResult.reason instanceof Error ? monthlySalesResult.reason.message : "Failed to load monthly sales");
    } else {
      setMonthlySalesReport(null);
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

    if (staffTomorrowResult.status === "fulfilled" && staffTomorrowResult.value) {
      setStaffTomorrow(staffTomorrowResult.value.staffToday);
    } else {
      setStaffTomorrow(null);
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

    setLoading(false);
  };

  useEffect(() => {
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewManagerWidgets]);

  const firstName = useMemo(() => getFirstName(user?.name, user?.username), [user?.name, user?.username]);
  const headerDateLabel = useMemo(
    () => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(clock),
    [clock],
  );
  const headerTimeLabel = useMemo(
    () => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(clock),
    [clock],
  );

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
    const rotaLink = user?.role === "ADMIN" || user?.role === "MANAGER"
        ? "/management/staff-rota"
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

  const rotaLink = quickActions.find((action) => action.label === "View Rota")?.to;
  const tradingWeatherTimeline = weather?.tradingDayTimeline ?? [];

  return (
    <div className="page-shell page-shell-workspace ui-page ui-page--workspace dashboard-v1">
      <div className="dashboard-hero-stack">
      <SurfaceCard className="dashboard-v1-header ui-surface-card--soft">
        <div className="dashboard-v1-header-top">
          <div className="dashboard-v1-header-greeting">
            <PageHeader title={`Hello ${firstName}`} />
          </div>
          <div className="dashboard-header-clock" aria-label={`Current time ${headerDateLabel} ${headerTimeLabel}`}>
            <strong className="dashboard-header-clock-time">{headerTimeLabel}</strong>
            <span className="dashboard-header-clock-date">{headerDateLabel}</span>
          </div>
          <div className="dashboard-v1-header-actions">
            <div className="actions-inline">
              <button type="button" onClick={() => void loadDashboard()} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh dashboard"}
              </button>
            </div>
          </div>
        </div>
        <div className="dashboard-link-grid">
          {quickActions.map((action) => (
            <DashboardActionButton key={action.label} {...action} />
          ))}
        </div>
      </SurfaceCard>

      <div className="dashboard-context-row">
        <SurfaceCard className="dashboard-weather-strip" aria-label="Trading weather">
          {!weather ? (
            <EmptyState title="Loading weather" description="Fetching the latest trading-hour forecast." />
          ) : weather.status === "ready" && weather.today ? (
            <div className="dashboard-weather-strip-content">
              {tradingWeatherTimeline.length ? (
                <div className="dashboard-weather-timeline" aria-label="Trading hour weather change points">
                  <div className="dashboard-weather-timeline-points" role="list">
                    {tradingWeatherTimeline.map((point) => (
                      <div key={point.time} className="dashboard-weather-timeline-point" role="listitem">
                        <strong className="dashboard-weather-timeline-hour">{point.label}</strong>
                        <span
                          className={`dashboard-weather-timeline-icon dashboard-weather-timeline-icon--${point.kind}`}
                          aria-hidden="true"
                        >
                          {weatherGlyph[point.kind]}
                        </span>
                        <span className="dashboard-weather-timeline-temp">{point.temperatureC}°</span>
                        {(point.precipitationMm > 0.1 || point.precipitationProbabilityPercent >= 35) ? (
                          <span className="dashboard-weather-timeline-rain">{point.precipitationProbabilityPercent}% rain</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {weather.tomorrow ? (
                    <div className="dashboard-weather-tomorrow-inline">
                      <span className="metric-label dashboard-metric-label">Tomorrow</span>
                      <strong>{weather.tomorrow.summary}</strong>
                      <span>{weather.tomorrow.highC}° / {weather.tomorrow.lowC}°</span>
                      <span>Rain {weather.tomorrow.precipitationMm} mm</span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="dashboard-weather-strip-empty">
                  Trading-hour change points are unavailable right now.
                </div>
              )}
            </div>
          ) : weather.status === "missing_location" ? (
            <EmptyState
              title="Weather unavailable"
              description={user?.role === "ADMIN" ? (
                <>
                  Set the store postcode in <Link to="/settings/store-info">Settings</Link>.
                </>
              ) : "Ask an admin to set the store postcode in Settings."}
            />
          ) : (
            <EmptyState title="Weather temporarily unavailable" description={weather.message || "Forecast data could not be loaded right now."} />
          )}
        </SurfaceCard>

        <SurfaceCard className="dashboard-staff-strip" aria-label="Staff today">
          <SectionHeader
            title="Staff Today"
            actions={(
              <div className="actions-inline">
                {rotaLink ? <Link className="button-link button-link-compact dashboard-inline-action" to={rotaLink}>View Rota</Link> : null}
              </div>
            )}
          />

          {!staffToday || !staffTomorrow ? (
            <EmptyState title="Loading rota summary" description="Fetching today and tomorrow’s staffing coverage." />
          ) : (
            <div className="dashboard-staff-roster-grid">
              {[
                { label: "Today", staffDay: staffToday },
                { label: "Tomorrow", staffDay: staffTomorrow },
              ].map(({ label, staffDay }) => (
                <section key={label} className="dashboard-staff-roster-column">
                  <div className="dashboard-staff-roster-header">
                    <span className="metric-label dashboard-metric-label">{label}</span>
                  </div>

                  {staffDay.summary.isClosed ? (
                    <div className="dashboard-staff-roster-closed">
                      {staffDay.summary.closedReason ?? "Store closed"}
                    </div>
                  ) : staffDay.staff.length || (staffDay.holidayStaff ?? []).length ? (
                    <div className="dashboard-staff-roster-list">
                      {staffDay.staff.map((entry) => (
                        <div key={`${label}-${entry.staffId}-${entry.shiftType}`} className="dashboard-staff-roster-row">
                          <span className="dashboard-staff-roster-name">{entry.name}</span>
                          <span className="status-badge status-info">{getShiftBadgeLabel(entry.shiftType)}</span>
                        </div>
                      ))}
                      {(staffDay.holidayStaff ?? []).map((entry) => (
                        <div key={`${label}-holiday-${entry.staffId}`} className="dashboard-staff-roster-row dashboard-staff-roster-row-muted">
                          <span className="dashboard-staff-roster-name">{entry.name}</span>
                          <span className="status-badge">{getShiftBadgeLabel(entry.shiftType)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="dashboard-staff-roster-empty">No staff scheduled</div>
                  )}
                </section>
              ))}
            </div>
          )}
        </SurfaceCard>
      </div>
      </div>

      <section className="dashboard-v1-group" aria-label="Financial snapshot">
        <div className="dashboard-summary-grid dashboard-v1-kpis ui-kpi-grid">
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
            label="Monthly Sales"
            value={monthlySalesReport
              ? formatDashboardCurrencyFromPence(monthlySalesReport.summary.revenuePence)
              : canViewManagerWidgets
                ? "—"
                : "Manager only"}
            detail={monthlySalesReport
              ? buildMonthlySalesTileDetail(monthlySalesReport)
              : canViewManagerWidgets
                ? "Current-month sales summary is unavailable."
                : "Financial analytics are visible to managers and admins."}
            href={canViewManagerWidgets ? "/reports/financial" : undefined}
            placeholder={!monthlySalesReport}
          />
          <DashboardMetricCard
            label="Monthly Margin"
            value={monthlyMarginReport
              ? formatDashboardCurrencyFromPence(monthlyMarginReport.summary.grossMarginPence)
              : canViewManagerWidgets
                ? "—"
                : "Manager only"}
            detail={monthlyMarginReport
              ? buildMonthlyMarginTileDetail(monthlyMarginReport)
              : canViewManagerWidgets
                ? "Current-month financial summary is unavailable."
                : "Financial analytics are visible to managers and admins."}
            href={canViewManagerWidgets ? "/reports/financial" : undefined}
            placeholder={!monthlyMarginReport}
          />
        </div>
      </section>

      <section className="dashboard-v1-group" aria-label="Operations overview">
        <div className="dashboard-v1-main-row">
        <SurfaceCard className="dashboard-v1-widget dashboard-v1-action-centre">
          <SectionHeader
            title="Action Centre"
            description="Top operational alerts only. Open the linked area to resolve the issue."
            actions={canViewManagerWidgets ? <Link to="/management/actions">Open full queue</Link> : null}
          />

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
              <EmptyState
                title="No operational alerts"
                description="The full management action centre still holds broader grouped oversight queues outside this dashboard."
              />
            )
          ) : (
            <EmptyState
              title="Manager view"
              description="Action Centre is available to managers. Staff can jump directly into POS, workshop, customers, and inventory from the quick actions above."
            />
          )}
        </SurfaceCard>

        <SurfaceCard className="dashboard-v1-widget">
          <SectionHeader
            title="Workshop Snapshot"
            description="A fast count of jobs waiting, active, ready for pickup, and still open."
            actions={(
              <div className="actions-inline">
                <Link to="/workshop">Job Board</Link>
                <Link to="/workshop/collection">Collection</Link>
              </div>
            )}
          />

          <div className="dashboard-v1-stat-grid">
            <DashboardStatCard
              label="Outstanding"
              value={outstandingWorkshopJobs === null ? "—" : `${outstandingWorkshopJobs}`}
              detail={`Due today ${workshopSummary?.dueToday ?? 0} · Overdue ${workshopSummary?.overdue ?? 0}`}
            />
            <DashboardStatCard
              label="Waiting"
              value={workshopSummary ? workshopWaitingCount : "—"}
              detail="Jobs waiting for approval, parts, or scheduling decisions."
            />
            <DashboardStatCard
              label="In Progress"
              value={workshopSummary ? workshopInProgressCount : "—"}
              detail="Active bench work already underway."
            />
            <DashboardStatCard
              label="Ready for Pickup"
              value={workshopSummary ? workshopReadyCount : "—"}
              detail="Completed jobs ready for customer handover."
            />
          </div>
        </SurfaceCard>

        <SurfaceCard className="dashboard-v1-widget">
          <SectionHeader
            title="Rentals"
            description="Today and tomorrow’s hire desk handoffs without opening the full rental workspace."
            actions={canViewManagerWidgets ? <Link to="/rental/calendar">Rental Calendar</Link> : null}
          />

          {canViewManagerWidgets ? (
            <div className="dashboard-v1-stat-grid">
              <DashboardStatCard label="Pickups Today" value={rentalSnapshot.pickupsToday} detail="Reserved bikes due out today." />
              <DashboardStatCard label="Pickups Tomorrow" value={rentalSnapshot.pickupsTomorrow} detail="Reserved bikes due out tomorrow." />
              <DashboardStatCard label="Returns Today" value={rentalSnapshot.returnsToday} detail="Checked-out bikes expected back today." />
              <DashboardStatCard label="Returns Tomorrow" value={rentalSnapshot.returnsTomorrow} detail="Checked-out bikes expected back tomorrow." />
              <DashboardStatCard label="Overdue" value={rentalSnapshot.overdue} detail="Checked-out rentals already past due back time." />
            </div>
          ) : (
            <EmptyState
              title="Manager view"
              description="Rental operations are configured for manager access only on this deployment. The widget remains in place so the dashboard structure is consistent when rental access is enabled."
            />
          )}
        </SurfaceCard>
        </div>
      </section>

    </div>
  );
};
