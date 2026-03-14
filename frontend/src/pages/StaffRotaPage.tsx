import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { apiDelete, apiGet, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useAuth } from "../auth/AuthContext";
import { HolidayDecisionModal } from "../components/HolidayDecisionModal";
import { HolidayRequestsPanel, type HolidayRequestItem } from "../components/HolidayRequestsPanel";

type RotaShiftType = "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOLIDAY";
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

type RotaImportPreview = {
  previewKey: string;
  fileName: string;
  detectedDelimiter: "," | "\t" | ";";
  period: {
    startsOn: string;
    endsOn: string;
  };
  summary: {
    weekBlocks: number;
    parsedAssignments: number;
    skippedCells: number;
    warningCount: number;
    matchedStaffCount: number;
  };
  warnings: string[];
};

type RotaImportResult = RotaImportPreview & {
  importBatchKey: string;
  createdAssignments: number;
  updatedAssignments: number;
  createdByStaffId: string | null;
  rotaPeriod: {
    id: string;
    label: string;
    startsOn: string;
    endsOn: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
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

const shiftShortLabel = (shiftType: RotaShiftType | null) => {
  if (shiftType === "FULL_DAY") {
    return "F";
  }
  if (shiftType === "HALF_DAY_AM") {
    return "AM";
  }
  if (shiftType === "HALF_DAY_PM") {
    return "PM";
  }
  if (shiftType === "HOLIDAY") {
    return "H";
  }
  return "—";
};

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
  return "rota-shift-pill";
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
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overview, setOverview] = useState<RotaOverviewResponse | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<RotaImportPreview | null>(null);
  const [importResult, setImportResult] = useState<RotaImportResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
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

  const selectedPeriodId = searchParams.get("periodId") ?? undefined;
  const staffScope = searchParams.get("staffScope") === "all" ? "all" : "assigned";
  const roleFilter = searchParams.get("role") ?? "ALL";
  const searchFilter = searchParams.get("search") ?? "";
  const isAdmin = user?.role === "ADMIN";
  const canEditGrid = user?.role === "MANAGER" || user?.role === "ADMIN";
  const isSettingsRoute = location.pathname.startsWith("/settings");

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

  useEffect(() => {
    setOpenEditorCellKey(null);
    void loadOverview(selectedPeriodId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodId, staffScope, roleFilter, searchFilter]);

  useEffect(() => {
    void loadHolidayRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holidayRequestFilter]);

  const currentPeriod = overview?.period ?? null;
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

  const goToPeriod = (periodId: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("periodId", periodId);
    setSearchParams(nextParams);
  };

  const handleImportFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0] ?? null;
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      setImportFileName(file.name);
      setImportText(text);
      setImportPreview(null);
      setImportResult(null);
    } catch (fileError) {
      error(fileError instanceof Error ? fileError.message : "Failed to read rota spreadsheet");
      setImportFileName("");
      setImportText("");
      setImportPreview(null);
      setImportResult(null);
    } finally {
      input.value = "";
    }
  };

  const previewImport = async () => {
    if (!importText.trim()) {
      error("Choose a rota export before previewing");
      return;
    }

    setPreviewLoading(true);
    try {
      const preview = await apiPost<RotaImportPreview>("/api/rota/import/preview", {
        spreadsheetText: importText,
        fileName: importFileName,
      });
      setImportPreview(preview);
      setImportResult(null);
      success("Rota import preview ready");
    } catch (previewError) {
      setImportPreview(null);
      error(previewError instanceof Error ? previewError.message : "Failed to preview rota import");
    } finally {
      setPreviewLoading(false);
    }
  };

  const confirmImport = async () => {
    if (!importPreview) {
      error("Run preview before importing");
      return;
    }

    setConfirmLoading(true);
    try {
      const result = await apiPost<RotaImportResult>("/api/rota/import/confirm", {
        spreadsheetText: importText,
        fileName: importFileName,
        previewKey: importPreview.previewKey,
      });
      setImportResult(result);
      setImportPreview(null);
      success(`Imported ${result.createdAssignments + result.updatedAssignments} rota assignment${result.createdAssignments + result.updatedAssignments === 1 ? "" : "s"}`);
      goToPeriod(result.rotaPeriod.id);
      await loadOverview(result.rotaPeriod.id, true);
    } catch (confirmError) {
      error(confirmError instanceof Error ? confirmError.message : "Failed to import rota");
    } finally {
      setConfirmLoading(false);
    }
  };

  const emptyState = !loading && !currentPeriod;
  const breadcrumbLabel = isSettingsRoute ? "Settings / Staff & Roles" : "Management / Staff";
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

  return (
    <div className="page-shell rota-page">
      <section className="card">
        <div className="card-header-row">
          <div>
            <p className="dashboard-v1-kicker">{breadcrumbLabel}</p>
            <h1>Staff Rota</h1>
            <p className="muted-text">
              Review imported rota periods, make live day-level scheduling edits, and use the same Store Info opening hours that power the dashboard Staff Today widget.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadOverview(selectedPeriodId, true)} disabled={loading || refreshing}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" onClick={() => window.print()} disabled={!currentPeriod}>Print view</button>
            <Link to="/dashboard">Dashboard</Link>
            {isAdmin ? <Link to="/settings/staff-list">Staff List</Link> : null}
            {isAdmin ? <Link to="/settings/roles-permissions">Roles & Permissions</Link> : null}
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Selected Period</span>
            <strong className="metric-value">{currentPeriod ? currentPeriod.label : "No rota loaded"}</strong>
            <span className="dashboard-metric-detail">Defaults to the current or latest available rota period.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Assigned Staff</span>
            <strong className="metric-value">{currentPeriod ? currentPeriod.summary.assignedStaffCount : 0}</strong>
            <span className="dashboard-metric-detail">People with at least one assignment in this period.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Assigned Days</span>
            <strong className="metric-value">{currentPeriod ? currentPeriod.summary.assignedDays : 0}</strong>
            <span className="dashboard-metric-detail">Scheduled non-holiday assignments across Monday to Saturday.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Latest Import</span>
            <strong className="metric-value">{currentPeriod?.summary.latestImportFileName ?? "Not imported yet"}</strong>
            <span className="dashboard-metric-detail">
              {currentPeriod?.summary.latestImportAt
                ? `Updated ${formatDateTime(currentPeriod.summary.latestImportAt)}`
                : "Use the import panel below to load the legacy weekly spreadsheet export."}
            </span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Period Review</h2>
            <p className="muted-text">Week-grouped rota review with imported assignments, inline manager edits, and closed-day context.</p>
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

        {emptyState ? (
          <div className="restricted-panel info-panel">
            <strong>No rota periods imported yet.</strong>
            <div className="muted-text">
              {isAdmin
                ? "Upload a legacy rota spreadsheet export below to create the first reviewable rota period in CorePOS."
                : "Ask an admin to import the current rota spreadsheet export so the dashboard and rota review page can show live staffing coverage."}
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
            </div>

            <div className="filter-row rota-filter-row">
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
                : "Showing staff who already have assignments in this period."}
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
                    {currentPeriod.weeks.map((week) => (
                      <th key={week.weekIndex} colSpan={currentPeriod.days.filter((day) => day.weekIndex === week.weekIndex).length}>
                        <div className="rota-week-heading">
                          <strong>Week {week.weekIndex + 1}</strong>
                          <span>{week.label}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {currentPeriod.days.map((day) => (
                      <th key={day.date} className={day.isClosed ? "rota-day-heading rota-day-heading-closed" : "rota-day-heading"}>
                        <div className="rota-day-heading-copy">
                          <strong>{day.weekdayLabel.slice(0, 3)}</strong>
                          <span>{day.shortDateLabel}</span>
                          {day.isClosed ? (
                            <span className="status-badge status-warning">Closed</span>
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
                          {!row.cells.some((cell) => cell.shiftType) ? (
                            <span className="table-secondary">No shifts in this view yet</span>
                          ) : null}
                        </div>
                      </th>
                      <td className="rota-sticky rota-sticky-role rota-staff-role">
                        <span className="status-badge status-info">{row.role}</span>
                      </td>
                      {row.cells.map((cell) => {
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
                                    {cell.shiftType ? (
                                      <span className={shiftClassName(cell.shiftType)}>
                                        {shiftShortLabel(cell.shiftType)}
                                      </span>
                                    ) : (
                                      <span className="table-secondary">—</span>
                                    )}
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
                                      {([
                                        ["FULL_DAY", "Full Day"],
                                        ["HALF_DAY_AM", "Half Day AM"],
                                        ["HALF_DAY_PM", "Half Day PM"],
                                        ["HOLIDAY", "Holiday"],
                                      ] as Array<[RotaShiftType, string]>).map(([shiftType, label]) => (
                                        <button
                                          key={shiftType}
                                          type="button"
                                          disabled={isSavingCell}
                                          onClick={() => {
                                            if (!currentPeriod) {
                                              return;
                                            }
                                            if (!confirmHolidayApprovedOverride(cell, `Replace with ${label}`)) {
                                              return;
                                            }
                                            void saveCellAssignment(
                                              {
                                                rotaPeriodId: currentPeriod.id,
                                                staffId: row.staffId,
                                                date: cell.date,
                                                shiftType,
                                              },
                                              cellKey,
                                            );
                                          }}
                                        >
                                          {label}
                                        </button>
                                      ))}
                                      <button
                                        type="button"
                                        disabled={!cell.assignmentId || isSavingCell}
                                        onClick={() => {
                                          if (!cell.assignmentId) {
                                            return;
                                          }
                                          if (!confirmHolidayApprovedOverride(cell, "Clear this assignment")) {
                                            return;
                                          }
                                          void clearCellAssignment(cell.assignmentId, cellKey);
                                        }}
                                      >
                                        Clear
                                      </button>
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
                      <td colSpan={currentPeriod.days.length + 2}>
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
            <h2>Import</h2>
            <p className="muted-text">
              Load the existing weekly-block spreadsheet export. Full-day interpretation is validated against Store Info opening hours instead of rota-only constants.
            </p>
          </div>
        </div>

        {isAdmin ? (
          <>
            <div className="filter-row">
              <label className="grow">
                Legacy rota export
                <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={(event) => void handleImportFileSelected(event)} />
              </label>
              <label className="grow">
                Import path
                <input value="Preview first, then confirm import" readOnly />
              </label>
            </div>

            <div className="actions-inline">
              <button
                type="button"
                className="primary"
                onClick={() => void previewImport()}
                disabled={previewLoading || confirmLoading || !importText.trim()}
              >
                {previewLoading ? "Previewing..." : "Preview import"}
              </button>
              <button
                type="button"
                onClick={() => void confirmImport()}
                disabled={confirmLoading || previewLoading || !importPreview}
              >
                {confirmLoading ? "Importing..." : "Confirm import"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportFileName("");
                  setImportText("");
                  setImportPreview(null);
                  setImportResult(null);
                }}
                disabled={previewLoading || confirmLoading}
              >
                Clear
              </button>
            </div>

            <p className="muted-text">
              {importFileName
                ? `Loaded file: ${importFileName}`
                : "Choose the exported rota sheet as CSV or TSV. The preview warns about unmatched staff or unexpected values and only imports exact supported patterns."}
            </p>
          </>
        ) : (
          <div className="restricted-panel info-panel">
            <strong>Import is admin-only.</strong>
            <div className="muted-text">
              Managers can review imported rota periods here, but uploads stay limited to admins so staff matching and import decisions remain controlled.
            </div>
          </div>
        )}

        {importPreview ? (
          <>
            <div className="dashboard-summary-grid">
              <div className="metric-card">
                <span className="metric-label">Target Period</span>
                <strong className="metric-value">{importPreview.period.startsOn} to {importPreview.period.endsOn}</strong>
                <span className="dashboard-metric-detail">Single six-week period required for this import.</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Week Blocks</span>
                <strong className="metric-value">{importPreview.summary.weekBlocks}</strong>
                <span className="dashboard-metric-detail">Weekly spreadsheet blocks detected.</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Parsed Assignments</span>
                <strong className="metric-value">{importPreview.summary.parsedAssignments}</strong>
                <span className="dashboard-metric-detail">Assignments ready to import after normalization.</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Warnings</span>
                <strong className="metric-value">{importPreview.summary.warningCount}</strong>
                <span className="dashboard-metric-detail">Unexpected values or staff matching issues to review.</span>
              </div>
            </div>

            <div className="rota-import-feedback">
              <div className="metric-card">
                <span className="metric-label">Detected delimiter</span>
                <strong className="metric-value">{importPreview.detectedDelimiter === "\t" ? "Tab" : importPreview.detectedDelimiter === ";" ? "Semicolon" : "Comma"}</strong>
                <span className="dashboard-metric-detail">Auto-detected from the uploaded export.</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Matched staff</span>
                <strong className="metric-value">{importPreview.summary.matchedStaffCount}</strong>
                <span className="dashboard-metric-detail">CorePOS staff records matched without guessing.</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Skipped cells</span>
                <strong className="metric-value">{importPreview.summary.skippedCells}</strong>
                <span className="dashboard-metric-detail">Blank, x, or warning rows excluded from import.</span>
              </div>
            </div>

            {importPreview.warnings.length ? (
              <div className="card rota-warning-card">
                <h3>Import Warnings</h3>
                <ul className="muted-text rota-warning-list">
                  {importPreview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="success-panel">
                <strong>Preview passed cleanly.</strong>
                <span>No warnings were found. You can confirm the import when ready.</span>
              </div>
            )}
          </>
        ) : null}

        {importResult ? (
          <div className="success-panel">
            <strong>Rota imported.</strong>
            <span>
              {importResult.createdAssignments} created, {importResult.updatedAssignments} updated in {importResult.rotaPeriod.label}.
            </span>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Holiday Requests</h2>
            <p className="muted-text">Approve or reject staff holiday requests. Approved requests are written back into the live rota as HOLIDAY assignments.</p>
          </div>
        </div>

        <HolidayRequestsPanel
          title="Holiday Requests"
          subtitle="Review pending items first, then switch into broader request history without leaving the rota workspace."
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
