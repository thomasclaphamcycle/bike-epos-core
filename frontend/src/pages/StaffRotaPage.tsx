import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiDelete, apiGet, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useAuth } from "../auth/AuthContext";
import { HolidayDecisionModal } from "../components/HolidayDecisionModal";
import { HolidayRequestsPanel, type HolidayRequestItem } from "../components/HolidayRequestsPanel";

type RotaShiftType = "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOLIDAY";
type RotaEditorShiftValue = RotaShiftType | "OFF";
type RotaAssignmentSource = "MANUAL" | "IMPORT" | "HOLIDAY_APPROVED";
type UserRole = "STAFF" | "MANAGER" | "ADMIN";

type RotaOverviewResponse = {
  selectedPeriodId: string | null;
  periods: Array<{
    id: string;
    label: string;
    startsOn: string;
    endsOn: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
    isCurrent: boolean;
    summary: {
      assignedStaffCount: number;
      assignedDays: number;
      holidayDays: number;
      importedAssignments: number;
      latestImportAt: string | null;
      latestImportBatchKey: string | null;
      latestImportFileName: string | null;
    };
  }>;
  period: null | {
    id: string;
    label: string;
    startsOn: string;
    endsOn: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
    notes: string | null;
    createdAt: string;
    updatedAt: string;
    weeks: Array<{
      weekIndex: number;
      label: string;
      startsOn: string;
      endsOn: string;
    }>;
    days: Array<{
      date: string;
      weekIndex: number;
      weekLabel: string;
      weekday: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY";
      weekdayLabel: string;
      shortDateLabel: string;
      isClosed: boolean;
      closedReason: string | null;
      opensAt: string | null;
      closesAt: string | null;
    }>;
    summary: {
      assignedStaffCount: number;
      assignedDays: number;
      holidayDays: number;
      importedAssignments: number;
      closedDays: number;
      latestImportAt: string | null;
      latestImportBatchKey: string | null;
      latestImportFileName: string | null;
    };
    staffRows: Array<{
      staffId: string;
      name: string;
      role: UserRole;
      cells: Array<{
        assignmentId: string | null;
        date: string;
        shiftType: RotaShiftType | null;
        note: string | null;
        source: RotaAssignmentSource | null;
        rawValue: string | null;
        isClosed: boolean;
        closedReason: string | null;
      }>;
    }>;
  };
};

type HolidayRequestsPayload = {
  scope: "mine" | "all";
  statusFilter: "ALL" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  requests: HolidayRequestItem[];
};

type HolidayRequestFilter = HolidayRequestsPayload["statusFilter"];

type RotaGridCell = NonNullable<RotaOverviewResponse["period"]>["staffRows"][number]["cells"][number];

type SaveRotaAssignmentResponse = {
  assignment: {
    id: string;
    rotaPeriodId: string;
    staffId: string;
    date: string;
    shiftType: RotaShiftType;
    source: RotaAssignmentSource;
  };
  previousSource: RotaAssignmentSource | null;
  replacedHolidayApproved: boolean;
};

type ClearRotaAssignmentResponse = {
  clearedAssignmentId: string;
  staffId: string;
  date: string;
  previousSource: RotaAssignmentSource;
};

type CreateRotaPeriodResponse = {
  created: boolean;
  rotaPeriod: {
    id: string;
    label: string;
    startsOn: string;
    endsOn: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
    notes: string | null;
  };
};

const shiftShortLabel = (shiftType: RotaShiftType | null) => {
  if (shiftType === "FULL_DAY") {
    return "Full";
  }
  if (shiftType === "HALF_DAY_AM") {
    return "AM";
  }
  if (shiftType === "HALF_DAY_PM") {
    return "PM";
  }
  if (shiftType === "HOLIDAY") {
    return "Holiday";
  }
  return "Off";
};

const SHIFT_OPTIONS: Array<{ value: RotaEditorShiftValue; label: string; shortLabel: string }> = [
  { value: "FULL_DAY", label: "Full Day", shortLabel: "Full" },
  { value: "HALF_DAY_AM", label: "AM", shortLabel: "AM" },
  { value: "HALF_DAY_PM", label: "PM", shortLabel: "PM" },
  { value: "OFF", label: "Off", shortLabel: "Off" },
  { value: "HOLIDAY", label: "Holiday", shortLabel: "Holiday" },
];

const sourceLabel = (source: RotaAssignmentSource | null) => {
  if (source === "IMPORT") {
    return "Imported";
  }
  if (source === "HOLIDAY_APPROVED") {
    return "Holiday approved";
  }
  if (source === "MANUAL") {
    return "Manual";
  }
  return null;
};

const visibleSourceLabel = (source: RotaAssignmentSource | null) => {
  if (source === "IMPORT") {
    return "Imported";
  }
  if (source === "HOLIDAY_APPROVED") {
    return "Holiday approved";
  }
  return null;
};

const shiftClassName = (shiftType: RotaShiftType | null) => {
  if (shiftType === "FULL_DAY") {
    return "rota-shift-pill rota-shift-pill-full";
  }
  if (shiftType === "HALF_DAY_AM") {
    return "rota-shift-pill rota-shift-pill-am";
  }
  if (shiftType === "HALF_DAY_PM") {
    return "rota-shift-pill rota-shift-pill-pm";
  }
  if (shiftType === "HOLIDAY") {
    return "rota-shift-pill rota-shift-pill-holiday";
  }
  return "rota-shift-pill rota-shift-pill-off";
};

const addDaysToDateKey = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const toMondayDateKey = (date: string) => {
  const value = new Date(`${date}T12:00:00.000Z`);
  const weekday = value.getUTCDay();
  const mondayDelta = weekday === 0 ? -6 : 1 - weekday;
  value.setUTCDate(value.getUTCDate() + mondayDelta);
  return value.toISOString().slice(0, 10);
};

const getDefaultCreatePeriodStart = (periods: RotaOverviewResponse["periods"] | undefined) => {
  if (!periods?.length) {
    return toMondayDateKey(new Date().toISOString().slice(0, 10));
  }

  const latestEndsOn = periods.reduce((current, period) => (
    period.endsOn > current ? period.endsOn : current
  ), periods[0].endsOn);

  return addDaysToDateKey(latestEndsOn, 1);
};

const getDefaultWeekIndex = (period: NonNullable<RotaOverviewResponse["period"]>) => {
  const today = new Date().toISOString().slice(0, 10);
  if (today < period.startsOn || today > period.endsOn) {
    return 0;
  }

  const start = new Date(`${period.startsOn}T00:00:00.000Z`);
  const current = new Date(`${today}T00:00:00.000Z`);
  const diffDays = Math.floor((current.getTime() - start.getTime()) / 86_400_000);
  return Math.max(0, Math.min(period.weeks.length - 1, Math.floor(diffDays / 7)));
};

const formatDateTime = (value: string | null) => {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const HOLIDAY_REQUEST_FILTERS: Array<{ value: HolidayRequestFilter; label: string }> = [
  { value: "PENDING", label: "Pending" },
  { value: "ALL", label: "All" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Cancelled" },
];

export const StaffRotaPage = () => {
  const { user } = useAuth();
  const { error, success } = useToasts();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overview, setOverview] = useState<RotaOverviewResponse | null>(null);
  const [holidayRequests, setHolidayRequests] = useState<HolidayRequestItem[]>([]);
  const [holidayRequestsLoading, setHolidayRequestsLoading] = useState(true);
  const [holidayRequestFilter, setHolidayRequestFilter] = useState<HolidayRequestFilter>("PENDING");
  const [holidayRequestBusyId, setHolidayRequestBusyId] = useState<string | null>(null);
  const [decisionModalState, setDecisionModalState] = useState<{
    mode: "approve" | "reject";
    request: HolidayRequestItem;
  } | null>(null);
  const [openEditorCellKey, setOpenEditorCellKey] = useState<string | null>(null);
  const [savingCellKey, setSavingCellKey] = useState<string | null>(null);
  const [createPeriodStartsOn, setCreatePeriodStartsOn] = useState("");
  const [createPeriodLoading, setCreatePeriodLoading] = useState(false);
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(0);

  const selectedPeriodId = searchParams.get("periodId") ?? undefined;
  const staffScope = searchParams.get("staffScope") === "all" ? "all" : "assigned";
  const roleFilter = searchParams.get("role") ?? "ALL";
  const searchFilter = searchParams.get("search") ?? "";
  const isAdmin = user?.role === "ADMIN";
  const canEditGrid = user?.role === "MANAGER" || user?.role === "ADMIN";

  const updateQueryParam = (key: string, value: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (!value.trim() || value === "ALL" || value === "assigned") {
      nextParams.delete(key);
    } else {
      nextParams.set(key, value);
    }
    setSearchParams(nextParams);
  };

  const loadOverview = async (periodId?: string, silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const query = new URLSearchParams();
      if (periodId?.trim()) {
        query.set("periodId", periodId.trim());
      }
      if (staffScope === "all") {
        query.set("staffScope", "all");
      }
      if (roleFilter !== "ALL") {
        query.set("role", roleFilter);
      }
      if (searchFilter.trim()) {
        query.set("search", searchFilter.trim());
      }
      const payload = await apiGet<RotaOverviewResponse>(`/api/rota${query.toString() ? `?${query.toString()}` : ""}`);
      setOverview(payload);
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load staff rota");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadHolidayRequests = async (silent = false) => {
    if (!silent) {
      setHolidayRequestsLoading(true);
    }

    try {
      const query = new URLSearchParams({
        scope: "all",
        status: holidayRequestFilter,
      });
      const payload = await apiGet<HolidayRequestsPayload>(`/api/rota/holiday-requests?${query.toString()}`);
      setHolidayRequests(payload.requests ?? []);
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load holiday requests");
    } finally {
      setHolidayRequestsLoading(false);
    }
  };

  const loadBankHolidayStatus = async (silent = false) => {
    if (!silent) {
      setBankHolidayStatusLoading(true);
    }

    try {
      const payload = await apiGet<BankHolidaySyncStatus>("/api/rota/bank-holidays/status");
      setBankHolidayStatus(payload);
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load bank holiday status");
    } finally {
      setBankHolidayStatusLoading(false);
    }
  };

  useEffect(() => {
    setOpenEditorCellKey(null);
    void loadOverview(selectedPeriodId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodId, staffScope, roleFilter, searchFilter]);

  useEffect(() => {
    void loadHolidayRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holidayRequestFilter]);

  useEffect(() => {
    setCreatePeriodStartsOn(getDefaultCreatePeriodStart(overview?.periods));
  }, [overview?.periods]);

  const currentPeriod = overview?.period ?? null;
  useEffect(() => {
    if (!currentPeriod) {
      setSelectedWeekIndex(0);
      return;
    }

    setSelectedWeekIndex((current) => (
      currentPeriod.weeks[current] ? current : getDefaultWeekIndex(currentPeriod)
    ));
  }, [currentPeriod]);

  const currentPeriodIndex = useMemo(() => (
    overview?.periods.findIndex((period) => period.id === (currentPeriod?.id ?? overview?.selectedPeriodId)) ?? -1
  ), [currentPeriod?.id, overview?.periods, overview?.selectedPeriodId]);
  const visibleStaffCount = currentPeriod?.staffRows.length ?? 0;
  const unassignedVisibleStaffCount = useMemo(
    () => currentPeriod?.staffRows.filter((row) => !row.cells.some((cell) => cell.shiftType)).length ?? 0,
    [currentPeriod],
  );

  const previousPeriod = currentPeriodIndex > 0 ? overview?.periods[currentPeriodIndex - 1] ?? null : null;
  const nextPeriod = currentPeriodIndex >= 0 && overview ? overview.periods[currentPeriodIndex + 1] ?? null : null;
  const selectedWeek = currentPeriod?.weeks[selectedWeekIndex] ?? null;
  const visibleDayIndices = useMemo(() => (
    currentPeriod?.days.reduce<number[]>((indices, day, index) => {
      if (day.weekIndex === selectedWeekIndex) {
        indices.push(index);
      }
      return indices;
    }, []) ?? []
  ), [currentPeriod?.days, selectedWeekIndex]);
  const visibleDays = useMemo(
    () => visibleDayIndices
      .map((index) => currentPeriod?.days[index] ?? null)
      .filter((day): day is NonNullable<RotaOverviewResponse["period"]>["days"][number] => day !== null),
    [currentPeriod?.days, visibleDayIndices],
  );

  const goToPeriod = (periodId: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("periodId", periodId);
    setSearchParams(nextParams);
  };

  const createPeriod = async () => {
    if (!createPeriodStartsOn.trim()) {
      error("Choose a Monday start date for the rota period");
      return;
    }

    setCreatePeriodLoading(true);
    try {
      const result = await apiPost<CreateRotaPeriodResponse>("/api/rota/periods", {
        startsOn: createPeriodStartsOn,
      });
      success(result.created ? "Rota period created." : "Rota period already existed.");
      goToPeriod(result.rotaPeriod.id);
      await loadOverview(result.rotaPeriod.id, true);
    } catch (createError) {
      error(createError instanceof Error ? createError.message : "Failed to create rota period");
    } finally {
      setCreatePeriodLoading(false);
    }
  };

  const emptyState = !loading && !currentPeriod;
  const holidayRequestFilterOptions = useMemo(() => HOLIDAY_REQUEST_FILTERS.map((filter) => ({
    value: filter.value,
    label: filter.value === holidayRequestFilter
      ? `${filter.label} (${holidayRequests.length})`
      : filter.label,
  })), [holidayRequestFilter, holidayRequests.length]);

  const submitDecision = async (decisionNotes: string) => {
    if (!decisionModalState) {
      return;
    }

    setHolidayRequestBusyId(decisionModalState.request.id);
    try {
      if (decisionModalState.mode === "approve") {
        await apiPost(`/api/rota/holiday-requests/${encodeURIComponent(decisionModalState.request.id)}/approve`, {
          decisionNotes,
        });
        success("Holiday request approved.");
        await Promise.all([
          loadHolidayRequests(true),
          loadOverview(selectedPeriodId, true),
        ]);
      } else {
        await apiPost(`/api/rota/holiday-requests/${encodeURIComponent(decisionModalState.request.id)}/reject`, {
          decisionNotes,
        });
        success("Holiday request rejected.");
        await loadHolidayRequests(true);
      }
      setDecisionModalState(null);
    } catch (decisionError) {
      error(decisionError instanceof Error ? decisionError.message : "Failed to update holiday request");
    } finally {
      setHolidayRequestBusyId(null);
    }
  };

  const confirmHolidayApprovedOverride = (
    cell: RotaGridCell,
    actionLabel: string,
  ) => {
    if (cell.source !== "HOLIDAY_APPROVED") {
      return true;
    }

    return window.confirm(
      `${actionLabel}?\n\nThis rota cell came from an approved holiday request. The request record will stay approved, but the live rota assignment will be replaced manually.`,
    );
  };

  const saveCellAssignment = async (
    input: {
      rotaPeriodId: string;
      staffId: string;
      date: string;
      shiftType: RotaShiftType;
    },
    cellKey: string,
  ) => {
    setSavingCellKey(cellKey);
    try {
      const result = await apiPost<SaveRotaAssignmentResponse>("/api/rota/assignments", input);
      setOpenEditorCellKey(null);
      await loadOverview(selectedPeriodId, true);
      success(
        result.replacedHolidayApproved
          ? "Saved manual rota override."
          : "Rota assignment saved.",
      );
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save rota assignment");
    } finally {
      setSavingCellKey(null);
    }
  };

  const clearCellAssignment = async (assignmentId: string, cellKey: string) => {
    setSavingCellKey(cellKey);
    try {
      await apiDelete<ClearRotaAssignmentResponse>(`/api/rota/assignments/${encodeURIComponent(assignmentId)}`);
      setOpenEditorCellKey(null);
      await loadOverview(selectedPeriodId, true);
      success("Rota assignment cleared.");
    } catch (clearError) {
      error(clearError instanceof Error ? clearError.message : "Failed to clear rota assignment");
    } finally {
      setSavingCellKey(null);
    }
  };

  const applyEditorShift = async (
    input: {
      rotaPeriodId: string;
      staffId: string;
      date: string;
    },
    cell: RotaGridCell,
    cellKey: string,
    value: RotaEditorShiftValue,
  ) => {
    if (value === "OFF") {
      if (!cell.assignmentId) {
        setOpenEditorCellKey(null);
        return;
      }
      if (!confirmHolidayApprovedOverride(cell, "Mark this day as Off")) {
        return;
      }
      await clearCellAssignment(cell.assignmentId, cellKey);
      return;
    }

    if (!confirmHolidayApprovedOverride(cell, `Replace with ${SHIFT_OPTIONS.find((option) => option.value === value)?.label ?? value}`)) {
      return;
    }

    await saveCellAssignment(
      {
        ...input,
        shiftType: value,
      },
      cellKey,
    );
  };

  return (
    <div className="page-shell rota-page">
      <section className="card">
        <div className="card-header-row">
          <div>
            <p className="dashboard-v1-kicker">Management / Staff</p>
            <h1>Staff Rota</h1>
            <p className="muted-text">
              Plan rota coverage inside CorePOS with a simple Monday to Saturday weekly editor. Store Info opening hours and closed-day rules stay as the source of truth for what can be scheduled.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadOverview(selectedPeriodId, true)} disabled={loading || refreshing}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" onClick={() => window.print()} disabled={!currentPeriod}>Print view</button>
            <Link to="/dashboard">Dashboard</Link>
            {isAdmin ? <Link to="/settings/staff-rota">Rota Tools</Link> : null}
            {isAdmin ? <Link to="/settings/staff-list">Staff List</Link> : null}
            {isAdmin ? <Link to="/settings/roles-permissions">Roles & Permissions</Link> : null}
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Selected Period</span>
            <strong className="metric-value">{currentPeriod ? currentPeriod.label : "No rota loaded"}</strong>
            <span className="dashboard-metric-detail">Six-week rota periods stay reusable whether they were created in-app or imported.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Assigned Staff</span>
            <strong className="metric-value">{currentPeriod ? currentPeriod.summary.assignedStaffCount : 0}</strong>
            <span className="dashboard-metric-detail">People with at least one assignment in this period.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Assigned Days</span>
            <strong className="metric-value">{currentPeriod ? currentPeriod.summary.assignedDays : 0}</strong>
            <span className="dashboard-metric-detail">Scheduled non-holiday assignments across editable Monday to Saturday trading days.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Planning Source</span>
            <strong className="metric-value">{currentPeriod?.summary.latestImportFileName ?? "Created in CorePOS"}</strong>
            <span className="dashboard-metric-detail">
              {currentPeriod?.summary.latestImportAt
                ? `Latest import updated ${formatDateTime(currentPeriod.summary.latestImportAt)}`
                : "Cells default to Off until you assign Full Day, AM, PM, or Holiday."}
            </span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Weekly Editor</h2>
            <p className="muted-text">Rows are staff, columns are Monday to Saturday, and Off remains the default state until a live assignment is added.</p>
          </div>
          <div className="actions-inline rota-period-controls">
            <button type="button" onClick={() => previousPeriod && goToPeriod(previousPeriod.id)} disabled={!previousPeriod}>
              Previous
            </button>
            <label className="rota-period-select">
              <span className="sr-only">Select rota period</span>
              <select
                value={currentPeriod?.id ?? overview?.selectedPeriodId ?? ""}
                onChange={(event) => goToPeriod(event.target.value)}
                disabled={!overview?.periods.length}
              >
                {overview?.periods.length ? overview.periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label}{period.isCurrent ? " · Current" : ""}
                  </option>
                )) : (
                  <option value="">No periods</option>
                )}
              </select>
            </label>
            <button type="button" onClick={() => nextPeriod && goToPeriod(nextPeriod.id)} disabled={!nextPeriod}>
              Next
            </button>
          </div>
        </div>

        {canEditGrid ? (
          <div className="rota-create-panel">
            <div>
              <strong>Create six-week rota period</strong>
              <p className="muted-text">
                Start on a Monday. Sunday stays closed, and store opening hours plus bank-holiday closures are reused automatically.
              </p>
            </div>
            <div className="rota-create-controls">
              <label>
                Start Monday
                <input
                  type="date"
                  value={createPeriodStartsOn}
                  onChange={(event) => setCreatePeriodStartsOn(event.target.value)}
                  disabled={createPeriodLoading}
                />
              </label>
              <button type="button" className="primary" onClick={() => void createPeriod()} disabled={createPeriodLoading}>
                {createPeriodLoading ? "Creating..." : "Create period"}
              </button>
            </div>
          </div>
        ) : null}

        {emptyState ? (
          <div className="restricted-panel info-panel">
            <strong>No rota period exists yet.</strong>
            <div className="muted-text">
              {canEditGrid
                ? "Create the first six-week period above, then fill in weekly assignments directly here. Import remains available below if you want to bring in a spreadsheet first."
                : "Ask a manager or admin to create the first rota period so live staffing can appear on the dashboard and rota pages."}
            </div>
          </div>
        ) : currentPeriod ? (
          <>
            <div className="rota-period-summary">
              <div className="rota-period-summary-item">
                <span className="metric-label">Dates</span>
                <strong>{currentPeriod.startsOn} to {currentPeriod.endsOn}</strong>
              </div>
              <div className="rota-period-summary-item">
                <span className="metric-label">Holiday Days</span>
                <strong>{currentPeriod.summary.holidayDays}</strong>
              </div>
              <div className="rota-period-summary-item">
                <span className="metric-label">Closed Days</span>
                <strong>{currentPeriod.summary.closedDays}</strong>
              </div>
              <div className="rota-period-summary-item">
                <span className="metric-label">Store Hours Source</span>
                <strong>Store Info opening hours</strong>
              </div>
              <div className="rota-period-summary-item">
                <span className="metric-label">Visible Staff</span>
                <strong>{visibleStaffCount}</strong>
              </div>
              <div className="rota-period-summary-item">
                <span className="metric-label">Editing Week</span>
                <strong>{selectedWeek?.label ?? "—"}</strong>
              </div>
            </div>

            <div className="filter-row rota-filter-row">
              <label className="grow">
                Week
                <select
                  value={selectedWeekIndex}
                  onChange={(event) => setSelectedWeekIndex(Number.parseInt(event.target.value, 10))}
                >
                  {currentPeriod.weeks.map((week) => (
                    <option key={week.weekIndex} value={week.weekIndex}>
                      Week {week.weekIndex + 1} · {week.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grow">
                Staff view
                <select
                  value={staffScope}
                  onChange={(event) => updateQueryParam("staffScope", event.target.value)}
                >
                  <option value="assigned">With assignments</option>
                  <option value="all">All active staff</option>
                </select>
              </label>
              <label className="grow">
                Role
                <select
                  value={roleFilter}
                  onChange={(event) => updateQueryParam("role", event.target.value)}
                >
                  <option value="ALL">All roles</option>
                  <option value="STAFF">Staff</option>
                  <option value="MANAGER">Manager</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </label>
              <label className="grow">
                Search staff
                <input
                  type="search"
                  value={searchFilter}
                  placeholder="Search by name"
                  onChange={(event) => updateQueryParam("search", event.target.value)}
                />
              </label>
            </div>

            <p className="muted-text rota-filter-summary">
              {staffScope === "all"
                ? "Showing active staff plus existing assignments for this period."
                : "Showing staff who already have assignments somewhere in this six-week period."}
              {unassignedVisibleStaffCount
                ? ` ${unassignedVisibleStaffCount} visible ${unassignedVisibleStaffCount === 1 ? "person has" : "people have"} no shifts yet.`
                : ""}
            </p>

            <div className="table-wrap rota-grid-wrap">
              <table className="table-primary rota-review-grid">
                <thead>
                  <tr>
                    <th className="rota-sticky rota-sticky-name" rowSpan={2}>Staff</th>
                    <th className="rota-sticky rota-sticky-role" rowSpan={2}>Role</th>
                    <th colSpan={visibleDays.length}>
                      <div className="rota-week-heading">
                        <strong>Week {selectedWeekIndex + 1}</strong>
                        <span>{selectedWeek?.label ?? "Selected week"}</span>
                      </div>
                    </th>
                  </tr>
                  <tr>
                    {visibleDays.map((day) => (
                      <th key={day.date} className={day.isClosed ? "rota-day-heading rota-day-heading-closed" : "rota-day-heading"}>
                        <div className="rota-day-heading-copy">
                          <strong>{day.weekdayLabel.slice(0, 3)}</strong>
                          <span>{day.shortDateLabel}</span>
                          {day.isClosed ? (
                            <>
                              <span className="status-badge status-warning">Closed</span>
                              {day.closedReason ? (
                                <span className="table-secondary rota-day-closed-reason">{day.closedReason}</span>
                              ) : null}
                            </>
                          ) : day.opensAt && day.closesAt ? (
                            <span className="muted-text rota-day-hours">{day.opensAt} - {day.closesAt}</span>
                          ) : null}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {currentPeriod.staffRows.length ? currentPeriod.staffRows.map((row) => (
                    <tr key={row.staffId}>
                      <th className="rota-sticky rota-sticky-name rota-staff-name" scope="row">
                        <div className="rota-staff-name-copy">
                          <span>{row.name}</span>
                          {!visibleDayIndices.some((index) => row.cells[index]?.shiftType) ? (
                            <span className="table-secondary">Off all week in this view</span>
                          ) : null}
                        </div>
                      </th>
                      <td className="rota-sticky rota-sticky-role rota-staff-role">
                        <span className="status-badge status-info">{row.role}</span>
                      </td>
                      {visibleDayIndices.map((dayIndex) => {
                        const cell = row.cells[dayIndex];
                        const cellKey = `${row.staffId}-${cell.date}`;
                        const isEditorOpen = openEditorCellKey === cellKey;
                        const isSavingCell = savingCellKey === cellKey;
                        const cellSourceLabel = sourceLabel(cell.source);
                        const cellVisibleSourceLabel = visibleSourceLabel(cell.source);
                        const triggerTitle = cell.isClosed
                          ? cell.closedReason || "Closed"
                          : canEditGrid
                            ? `Edit ${row.name} on ${cell.date}${cellSourceLabel ? ` · ${cellSourceLabel}` : ""}`
                            : cell.note || cell.rawValue || cellSourceLabel || "Rota assignment";

                        return (
                          <td
                            key={cellKey}
                            className={[
                              "rota-cell",
                              cell.isClosed ? "rota-cell-closed" : "",
                              canEditGrid && !cell.isClosed ? "rota-cell-editable" : "",
                              isEditorOpen ? "rota-cell-open" : "",
                            ].filter(Boolean).join(" ")}
                            title={triggerTitle}
                          >
                            {cell.isClosed ? (
                              <span className="table-secondary">{cell.closedReason ?? "Closed"}</span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="rota-cell-trigger"
                                  onClick={() => setOpenEditorCellKey((current) => current === cellKey ? null : cellKey)}
                                  disabled={!canEditGrid || isSavingCell}
                                >
                                  <div className="rota-cell-content">
                                    <span className={shiftClassName(cell.shiftType)}>
                                      {shiftShortLabel(cell.shiftType)}
                                    </span>
                                    {cell.note ? <span className="muted-text rota-cell-note">{cell.note}</span> : null}
                                    {cellVisibleSourceLabel ? <span className="table-secondary">{cellVisibleSourceLabel}</span> : null}
                                  </div>
                                </button>

                                {isEditorOpen ? (
                                  <div className="rota-cell-popover">
                                    <div className="rota-cell-popover-copy">
                                      <strong>{row.name}</strong>
                                      <span>{cell.date}</span>
                                      {cellSourceLabel ? <span className="table-secondary">Current source: {cellSourceLabel}</span> : null}
                                    </div>
                                    <div className="rota-cell-popover-actions">
                                      {SHIFT_OPTIONS.map(({ value, label }) => (
                                        <button
                                          key={value}
                                          type="button"
                                          disabled={isSavingCell}
                                          onClick={() => {
                                            if (!currentPeriod) {
                                              return;
                                            }
                                            void applyEditorShift(
                                              {
                                                rotaPeriodId: currentPeriod.id,
                                                staffId: row.staffId,
                                                date: cell.date,
                                              },
                                              cell,
                                              cellKey,
                                              value,
                                            );
                                          }}
                                        >
                                          {label}
                                        </button>
                                      ))}
                                      <button
                                        type="button"
                                        disabled={isSavingCell}
                                        onClick={() => setOpenEditorCellKey(null)}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                    {isSavingCell ? <span className="muted-text">Saving...</span> : null}
                                  </div>
                                ) : null}
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={visibleDays.length + 2}>
                        <div className="restricted-panel info-panel">
                          No staff match the current rota filters.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Holiday Requests</h2>
            <p className="muted-text">Keep pending leave decisions close to the planner. Approved requests still write back into the live rota as HOLIDAY assignments.</p>
          </div>
        </div>

        <HolidayRequestsPanel
          title="Holiday Requests"
          subtitle="Review pending leave without leaving the planning workspace."
          requests={holidayRequests}
          filterValue={holidayRequestFilter}
          filterOptions={holidayRequestFilterOptions}
          onFilterChange={(value) => setHolidayRequestFilter(value as HolidayRequestFilter)}
          loading={holidayRequestsLoading}
          onApprove={async (request) => {
            setDecisionModalState({
              mode: "approve",
              request,
            });
          }}
          onReject={async (request) => {
            setDecisionModalState({
              mode: "reject",
              request,
            });
          }}
          busyRequestId={holidayRequestBusyId}
          emptyMessage={
            holidayRequestFilter === "PENDING"
              ? "No pending holiday requests need review right now."
              : `No ${holidayRequestFilter.toLowerCase()} holiday requests in this view yet.`
          }
        />
      </section>

      <HolidayDecisionModal
        open={Boolean(decisionModalState)}
        mode={decisionModalState?.mode ?? "approve"}
        request={decisionModalState?.request ?? null}
        submitting={Boolean(holidayRequestBusyId)}
        onClose={() => {
          if (!holidayRequestBusyId) {
            setDecisionModalState(null);
          }
        }}
        onSubmit={submitDecision}
      />
    </div>
  );
};
