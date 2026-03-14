import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useAuth } from "../auth/AuthContext";

type RotaShiftType = "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOLIDAY";
type RotaAssignmentSource = "MANUAL" | "IMPORT";
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

const shiftLabel = (shiftType: RotaShiftType | null) => {
  if (shiftType === "FULL_DAY") {
    return "Full day";
  }
  if (shiftType === "HALF_DAY_AM") {
    return "Half day AM";
  }
  if (shiftType === "HALF_DAY_PM") {
    return "Half day PM";
  }
  if (shiftType === "HOLIDAY") {
    return "Holiday";
  }
  return "";
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

  const selectedPeriodId = searchParams.get("periodId") ?? undefined;
  const isAdmin = user?.role === "ADMIN";
  const isSettingsRoute = location.pathname.startsWith("/settings");

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
      const payload = await apiGet<RotaOverviewResponse>(`/api/rota${query.toString() ? `?${query.toString()}` : ""}`);
      setOverview(payload);
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load staff rota");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadOverview(selectedPeriodId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodId]);

  const currentPeriod = overview?.period ?? null;
  const currentPeriodIndex = useMemo(() => (
    overview?.periods.findIndex((period) => period.id === (currentPeriod?.id ?? overview?.selectedPeriodId)) ?? -1
  ), [currentPeriod?.id, overview?.periods, overview?.selectedPeriodId]);

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

  return (
    <div className="page-shell rota-page">
      <section className="card">
        <div className="card-header-row">
          <div>
            <p className="dashboard-v1-kicker">{breadcrumbLabel}</p>
            <h1>Staff Rota</h1>
            <p className="muted-text">
              Review imported rota periods, check who is scheduled across the six-week block, and use the same Store Info opening hours that power the dashboard Staff Today widget.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadOverview(selectedPeriodId, true)} disabled={loading || refreshing}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
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
            <p className="muted-text">Week-grouped rota review with imported assignments and closed-day context.</p>
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
            </div>

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
                      <th className="rota-sticky rota-sticky-name rota-staff-name" scope="row">{row.name}</th>
                      <td className="rota-sticky rota-sticky-role rota-staff-role">
                        <span className="status-badge status-info">{row.role}</span>
                      </td>
                      {row.cells.map((cell) => (
                        <td
                          key={`${row.staffId}-${cell.date}`}
                          className={cell.isClosed ? "rota-cell rota-cell-closed" : "rota-cell"}
                          title={cell.note || cell.rawValue || cell.closedReason || undefined}
                        >
                          {cell.shiftType ? (
                            <div className="rota-cell-content">
                              <span className={shiftClassName(cell.shiftType)}>{shiftLabel(cell.shiftType)}</span>
                              {cell.note ? <span className="muted-text rota-cell-note">{cell.note}</span> : null}
                              {cell.source === "IMPORT" ? <span className="table-secondary">Imported</span> : null}
                            </div>
                          ) : cell.isClosed ? (
                            <span className="table-secondary">{cell.closedReason ?? "Closed"}</span>
                          ) : (
                            <span className="table-secondary">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={currentPeriod.days.length + 2}>
                        <div className="restricted-panel info-panel">
                          No assignments are stored for this period yet.
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
    </div>
  );
};
