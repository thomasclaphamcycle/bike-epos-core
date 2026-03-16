import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "../components/ToastProvider";

type RotaImportPreview = {
  previewKey: string;
  fileName: string;
  detectedDelimiter: "," | "\t" | ";";
  period: {
    startsOn: string;
    endsOn: string;
    rotaPeriodId: string | null;
    label: string | null;
    exists: boolean;
  };
  summary: {
    weekBlocks: number;
    parsedAssignments: number;
    parsedOffDays: number;
    skippedCells: number;
    warningCount: number;
    blockingIssueCount: number;
    matchedStaffCount: number;
    createCount: number;
    updateCount: number;
    clearCount: number;
    unchangedCount: number;
  };
  warnings: string[];
  blockingIssues: string[];
  canConfirm: boolean;
  changes: Array<{
    staffId: string;
    staffName: string;
    date: string;
    action: "CREATE" | "UPDATE" | "CLEAR" | "UNCHANGED";
    previousValue: string;
    nextValue: string;
  }>;
};

type RotaImportResult = RotaImportPreview & {
  importBatchKey: string;
  createdAssignments: number;
  updatedAssignments: number;
  clearedAssignments: number;
  unchangedAssignments: number;
  createdByStaffId: string | null;
  rotaPeriod: {
    id: string;
    label: string;
    startsOn: string;
    endsOn: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  };
};

type RotaOverviewResponse = {
  selectedPeriodId: string | null;
  periods: Array<{
    id: string;
    label: string;
    startsOn: string;
    endsOn: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
    isCurrent: boolean;
  }>;
};

type BankHolidaySyncStatus = {
  region: "england-and-wales";
  sourceUrl: string;
  lastSyncedAt: string | null;
  lastSyncedByStaffId: string | null;
  lastResult: null | {
    createdCount: number;
    updatedCount: number;
    removedCount: number;
    unchangedCount: number;
    skippedManualCount: number;
    warningCount: number;
  };
  storedCount: number;
  upcoming: Array<{
    date: string;
    name: string;
  }>;
};

type BankHolidaySyncResult = BankHolidaySyncStatus & {
  warnings: string[];
};

const getCurrentMonday = () => {
  const now = new Date();
  const weekday = now.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() + mondayOffset);
  return monday.toISOString().slice(0, 10);
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

const delimiterLabel = (value: "," | "\t" | ";") => {
  if (value === "\t") {
    return "Tab";
  }
  if (value === ";") {
    return "Semicolon";
  }
  return "Comma";
};

export const StaffRotaToolsPage = () => {
  const { user } = useAuth();
  const { error, success } = useToasts();
  const [importFileName, setImportFileName] = useState("");
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<RotaImportPreview | null>(null);
  const [importResult, setImportResult] = useState<RotaImportResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [periodsLoading, setPeriodsLoading] = useState(true);
  const [periods, setPeriods] = useState<RotaOverviewResponse["periods"]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [templateStartsOn, setTemplateStartsOn] = useState(getCurrentMonday());
  const [bankHolidayStatus, setBankHolidayStatus] = useState<BankHolidaySyncStatus | null>(null);
  const [bankHolidayStatusLoading, setBankHolidayStatusLoading] = useState(true);
  const [bankHolidaySyncLoading, setBankHolidaySyncLoading] = useState(false);
  const [bankHolidayWarnings, setBankHolidayWarnings] = useState<string[]>([]);

  const isAdmin = user?.role === "ADMIN";

  const loadPeriods = async () => {
    setPeriodsLoading(true);
    try {
      const payload = await apiGet<RotaOverviewResponse>("/api/rota?staffScope=all");
      setPeriods(payload.periods);
      setSelectedPeriodId((current) => current || payload.selectedPeriodId || payload.periods[0]?.id || "");
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load rota periods");
    } finally {
      setPeriodsLoading(false);
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
    void loadPeriods();
    void loadBankHolidayStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      error("Choose a rota spreadsheet before previewing");
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
      success(preview.canConfirm ? "Rota update preview ready" : "Preview found spreadsheet issues to fix");
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
    if (!importPreview.canConfirm) {
      error("Fix the spreadsheet issues shown in preview before applying changes");
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
      setSelectedPeriodId(result.rotaPeriod.id);
      await loadPeriods();
      success(
        `Applied rota update: ${result.createdAssignments} created, ${result.updatedAssignments} updated, ${result.clearedAssignments} cleared.`,
      );
    } catch (confirmError) {
      error(confirmError instanceof Error ? confirmError.message : "Failed to import rota");
    } finally {
      setConfirmLoading(false);
    }
  };

  const syncBankHolidays = async () => {
    setBankHolidaySyncLoading(true);
    try {
      const result = await apiPost<BankHolidaySyncResult>("/api/rota/bank-holidays/sync");
      setBankHolidayStatus(result);
      setBankHolidayWarnings(result.warnings);
      success(`UK bank holidays synced. ${result.lastResult?.createdCount ?? 0} created, ${result.lastResult?.updatedCount ?? 0} updated.`);
    } catch (syncError) {
      error(syncError instanceof Error ? syncError.message : "Failed to sync UK bank holidays");
    } finally {
      setBankHolidaySyncLoading(false);
    }
  };

  const templateHref = useMemo(
    () => `/api/rota/template?startsOn=${encodeURIComponent(templateStartsOn || getCurrentMonday())}`,
    [templateStartsOn],
  );

  const exportHref = selectedPeriodId
    ? `/api/rota/periods/${encodeURIComponent(selectedPeriodId)}/export`
    : "";

  return (
    <div className="page-shell rota-tools-page">
      <section className="card">
        <div className="card-header-row">
          <div>
            <p className="dashboard-v1-kicker">Management / Rota</p>
            <h1>Rota Tools</h1>
            <p className="muted-text">
              Keep spreadsheet workflow and closure admin here so the planner stays focused on live scheduling. These tools still use the same canonical rota, closed-day, and Store Info rules as the weekly editor.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management/staff-rota">Open planner</Link>
            <Link to="/dashboard">Dashboard</Link>
            {isAdmin ? <Link to="/settings/store-info">Store Info</Link> : null}
            {isAdmin ? <Link to="/settings/staff-list">Staff List</Link> : null}
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Spreadsheet path</span>
            <strong className="metric-value">Template → Export → Preview</strong>
            <span className="dashboard-metric-detail">Managers can round-trip rota periods through one spreadsheet structure instead of using a migration-only import.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Current periods</span>
            <strong className="metric-value">{periods.length}</strong>
            <span className="dashboard-metric-detail">Export an existing six-week block or start from a fresh template for the next one.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Bank holiday source</span>
            <strong className="metric-value">GOV.UK sync</strong>
            <span className="dashboard-metric-detail">Closed days still feed the same RotaClosedDay layer used by planning, holiday approvals, and dashboard staffing.</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Spreadsheet Workflow</h2>
            <p className="muted-text">
              Download a Monday-Saturday template, export an existing six-week period, then preview updates safely before CorePOS applies them.
            </p>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">1. Template</span>
            <strong className="metric-value">Start a clean block</strong>
            <span className="dashboard-metric-detail">Use Full, AM, PM, Off, and Holiday only. Sundays are omitted.</span>
            <label className="grow">
              Start Monday
              <input
                type="date"
                value={templateStartsOn}
                onChange={(event) => setTemplateStartsOn(event.target.value)}
              />
            </label>
            <a className="button-link" href={templateHref}>
              Download template
            </a>
          </div>

          <div className="metric-card">
            <span className="metric-label">2. Export</span>
            <strong className="metric-value">Round-trip a live period</strong>
            <span className="dashboard-metric-detail">Exports current rota values as Full, AM, PM, Off, and Holiday so managers can edit and re-import cleanly.</span>
            <label className="grow">
              Current period
              <select
                value={selectedPeriodId}
                onChange={(event) => setSelectedPeriodId(event.target.value)}
                disabled={periodsLoading || periods.length === 0}
              >
                {periods.length ? periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label}{period.isCurrent ? " · Current" : ""}
                  </option>
                )) : (
                  <option value="">{periodsLoading ? "Loading periods..." : "No periods"}</option>
                )}
              </select>
            </label>
            {selectedPeriodId ? (
              <a className="button-link" href={exportHref}>
                Export rota period
              </a>
            ) : (
              <span className="muted-text">Create a rota period in the planner before exporting.</span>
            )}
          </div>

          <div className="metric-card">
            <span className="metric-label">3. Update safely</span>
            <strong className="metric-value">Preview before apply</strong>
            <span className="dashboard-metric-detail">Preview shows creates, updates, clears, unchanged cells, and spreadsheet issues before anything is written.</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Import Update Preview</h2>
            <p className="muted-text">
              Import is now a safe update flow: preview validates staff, dates, shifts, and closed days before CorePOS touches the rota period.
            </p>
          </div>
        </div>

        <div className="filter-row">
          <label className="grow">
            Spreadsheet file
            <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={(event) => void handleImportFileSelected(event)} />
          </label>
          <label className="grow">
            Loaded file
            <input value={importFileName || "No file selected"} readOnly />
          </label>
        </div>

        <div className="actions-inline">
          <button
            type="button"
            className="primary"
            onClick={() => void previewImport()}
            disabled={previewLoading || confirmLoading || !importText.trim()}
          >
            {previewLoading ? "Previewing..." : "Preview update"}
          </button>
          <button
            type="button"
            onClick={() => void confirmImport()}
            disabled={confirmLoading || previewLoading || !importPreview || !importPreview.canConfirm}
          >
            {confirmLoading ? "Applying..." : "Apply update"}
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
            : "Choose a template or exported period. Blank cells remain ignored for legacy files; explicit Off clears an existing assignment during safe re-import."}
        </p>

        {importPreview ? (
          <>
            <div className="dashboard-summary-grid">
              <div className="metric-card">
                <span className="metric-label">Target Period</span>
                <strong className="metric-value">{importPreview.period.label ?? `${importPreview.period.startsOn} to ${importPreview.period.endsOn}`}</strong>
                <span className="dashboard-metric-detail">
                  {importPreview.period.exists ? "Existing six-week period will be updated." : "A new six-week period will be created on apply."}
                </span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Creates</span>
                <strong className="metric-value">{importPreview.summary.createCount}</strong>
                <span className="dashboard-metric-detail">New shifts added from the spreadsheet.</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Updates</span>
                <strong className="metric-value">{importPreview.summary.updateCount}</strong>
                <span className="dashboard-metric-detail">Existing shifts that will change state.</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Clears</span>
                <strong className="metric-value">{importPreview.summary.clearCount}</strong>
                <span className="dashboard-metric-detail">Existing assignments that Off will clear.</span>
              </div>
            </div>

            <div className="rota-import-feedback">
              <div className="metric-card">
                <span className="metric-label">Delimiter</span>
                <strong className="metric-value">{delimiterLabel(importPreview.detectedDelimiter)}</strong>
                <span className="dashboard-metric-detail">Detected from the uploaded sheet.</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Matched staff</span>
                <strong className="metric-value">{importPreview.summary.matchedStaffCount}</strong>
                <span className="dashboard-metric-detail">Staff resolved without guessing.</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Off cells</span>
                <strong className="metric-value">{importPreview.summary.parsedOffDays}</strong>
                <span className="dashboard-metric-detail">Explicit Off values parsed as safe clear instructions.</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Unchanged</span>
                <strong className="metric-value">{importPreview.summary.unchangedCount}</strong>
                <span className="dashboard-metric-detail">Cells already matching CorePOS.</span>
              </div>
            </div>

            {importPreview.blockingIssues.length ? (
              <div className="card rota-warning-card">
                <h3>Fix Before Applying</h3>
                <ul className="muted-text rota-warning-list">
                  {importPreview.blockingIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="success-panel">
                <strong>Spreadsheet passed validation.</strong>
                <span>The update can be applied safely when ready.</span>
              </div>
            )}

            {importPreview.warnings.length ? (
              <div className="card rota-warning-card">
                <h3>Preview Notes</h3>
                <ul className="muted-text rota-warning-list">
                  {importPreview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="card">
              <div className="card-header-row">
                <div>
                  <h3>Change Preview</h3>
                  <p className="muted-text">A compact sample of the spreadsheet changes CorePOS detected before apply.</p>
                </div>
              </div>
              <div className="holiday-request-list">
                {importPreview.changes.map((change) => (
                  <article key={`${change.staffId}-${change.date}`} className="holiday-request-card">
                    <div className="holiday-request-main">
                      <div className="holiday-request-title-row">
                        <strong>{change.staffName}</strong>
                        <span className={`status-badge ${change.action === "CREATE" ? "status-complete" : change.action === "UPDATE" ? "status-warning" : change.action === "CLEAR" ? "status-ready" : "status-info"}`}>
                          {change.action}
                        </span>
                      </div>
                      <div className="holiday-request-meta">
                        <span>{change.date}</span>
                        <span>{change.previousValue} → {change.nextValue}</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {importResult ? (
          <div className="success-panel">
            <strong>Rota update applied.</strong>
            <span>
              {importResult.createdAssignments} created, {importResult.updatedAssignments} updated, {importResult.clearedAssignments} cleared, {importResult.unchangedAssignments} unchanged in {importResult.rotaPeriod.label}.
            </span>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>UK Bank Holidays</h2>
            <p className="muted-text">
              Sync official closures into the rota closed-day layer so planning, holiday approvals, dashboard staffing, and spreadsheet preview all use the same closure data.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadBankHolidayStatus(true)} disabled={bankHolidayStatusLoading || bankHolidaySyncLoading}>
              {bankHolidayStatusLoading ? "Refreshing..." : "Refresh status"}
            </button>
            {isAdmin ? (
              <button type="button" className="primary" onClick={() => void syncBankHolidays()} disabled={bankHolidaySyncLoading}>
                {bankHolidaySyncLoading ? "Syncing..." : "Sync UK Bank Holidays"}
              </button>
            ) : null}
          </div>
        </div>

        {bankHolidayStatusLoading && !bankHolidayStatus ? (
          <div className="restricted-panel info-panel">Loading bank holiday status...</div>
        ) : bankHolidayStatus ? (
          <>
            <div className="dashboard-summary-grid">
              <div className="metric-card">
                <span className="metric-label">Region</span>
                <strong className="metric-value">England &amp; Wales</strong>
                <span className="dashboard-metric-detail">Current GOV.UK feed target for synced store closures.</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Last Synced</span>
                <strong className="metric-value">{formatDateTime(bankHolidayStatus.lastSyncedAt)}</strong>
                <span className="dashboard-metric-detail">
                  {bankHolidayStatus.lastSyncedByStaffId
                    ? `Triggered by ${bankHolidayStatus.lastSyncedByStaffId}.`
                    : "No sync has been recorded yet."}
                </span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Stored Holidays</span>
                <strong className="metric-value">{bankHolidayStatus.storedCount}</strong>
                <span className="dashboard-metric-detail">Future bank-holiday closures currently stored in CorePOS.</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Next Holiday</span>
                <strong className="metric-value">{bankHolidayStatus.upcoming[0]?.name ?? "None stored"}</strong>
                <span className="dashboard-metric-detail">{bankHolidayStatus.upcoming[0]?.date ?? "Run sync to load the current GOV.UK list."}</span>
              </div>
            </div>

            {bankHolidayStatus.lastResult ? (
              <div className="rota-period-summary">
                <div className="rota-period-summary-item">
                  <span className="metric-label">Created</span>
                  <strong>{bankHolidayStatus.lastResult.createdCount}</strong>
                </div>
                <div className="rota-period-summary-item">
                  <span className="metric-label">Updated</span>
                  <strong>{bankHolidayStatus.lastResult.updatedCount}</strong>
                </div>
                <div className="rota-period-summary-item">
                  <span className="metric-label">Removed</span>
                  <strong>{bankHolidayStatus.lastResult.removedCount}</strong>
                </div>
                <div className="rota-period-summary-item">
                  <span className="metric-label">Skipped Manual</span>
                  <strong>{bankHolidayStatus.lastResult.skippedManualCount}</strong>
                </div>
              </div>
            ) : null}

            {bankHolidayStatus.upcoming.length ? (
              <div className="holiday-request-list">
                {bankHolidayStatus.upcoming.slice(0, 4).map((holiday) => (
                  <article key={holiday.date} className="holiday-request-card">
                    <div className="holiday-request-main">
                      <div className="holiday-request-title-row">
                        <strong>{holiday.name}</strong>
                        <span className="status-badge status-warning">BANK HOLIDAY</span>
                      </div>
                      <div className="holiday-request-meta">
                        <span>{holiday.date}</span>
                        <span>Closed via RotaClosedDay</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}

            {!isAdmin ? (
              <div className="restricted-panel info-panel">
                Bank holiday sync remains admin-controlled. Managers can still plan against the synced closure data here and in the rota editor.
              </div>
            ) : null}

            {bankHolidayWarnings.length ? (
              <div className="restricted-panel info-panel">
                <strong>Sync warnings</strong>
                <div className="muted-text">{bankHolidayWarnings.join(" ")}</div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="restricted-panel info-panel">
            Bank holiday status is unavailable right now.
          </div>
        )}
      </section>
    </div>
  );
};
