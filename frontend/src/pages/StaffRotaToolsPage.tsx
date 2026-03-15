import { type ChangeEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";

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

export const StaffRotaToolsPage = () => {
  const { error, success } = useToasts();
  const [importFileName, setImportFileName] = useState("");
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<RotaImportPreview | null>(null);
  const [importResult, setImportResult] = useState<RotaImportResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [bankHolidayStatus, setBankHolidayStatus] = useState<BankHolidaySyncStatus | null>(null);
  const [bankHolidayStatusLoading, setBankHolidayStatusLoading] = useState(true);
  const [bankHolidaySyncLoading, setBankHolidaySyncLoading] = useState(false);
  const [bankHolidayWarnings, setBankHolidayWarnings] = useState<string[]>([]);

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

  return (
    <div className="page-shell rota-tools-page">
      <section className="card">
        <div className="card-header-row">
          <div>
            <p className="dashboard-v1-kicker">Settings / Staff &amp; Roles</p>
            <h1>Rota Tools</h1>
            <p className="muted-text">
              Keep setup and migration tasks here so the planner stays focused on live scheduling. These controls still use the same canonical rota, closed-day, and Store Info rules.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management/staff-rota">Open planner</Link>
            <Link to="/settings/store-info">Store Info</Link>
            <Link to="/settings/staff-list">Staff List</Link>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Planner focus</span>
            <strong className="metric-value">Scheduling stays separate</strong>
            <span className="dashboard-metric-detail">Use the planner for weekly rota editing and keep migration/admin tools here.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Bank holiday source</span>
            <strong className="metric-value">GOV.UK sync</strong>
            <span className="dashboard-metric-detail">Synced closures feed the shared RotaClosedDay layer used by planning and dashboard staffing.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Import path</span>
            <strong className="metric-value">Preview then confirm</strong>
            <span className="dashboard-metric-detail">Spreadsheet imports stay available for migration or bulk loading without crowding the planner.</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>UK Bank Holidays</h2>
            <p className="muted-text">
              Sync official closures into the rota closed-day layer so planning, holiday approvals, and dashboard staffing all use the same store closure data.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadBankHolidayStatus(true)} disabled={bankHolidayStatusLoading || bankHolidaySyncLoading}>
              {bankHolidayStatusLoading ? "Refreshing..." : "Refresh status"}
            </button>
            <button type="button" className="primary" onClick={() => void syncBankHolidays()} disabled={bankHolidaySyncLoading}>
              {bankHolidaySyncLoading ? "Syncing..." : "Sync UK Bank Holidays"}
            </button>
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

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Rota Import</h2>
            <p className="muted-text">
              Use this when migrating or bulk loading a legacy spreadsheet. Imported periods stay editable in the planner once they land in CorePOS.
            </p>
          </div>
        </div>

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
