import { CSSProperties, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type Severity = "CRITICAL" | "WARNING" | "INFO";

type ExceptionRow = {
  type: string;
  entityId: string;
  title: string;
  description: string;
  severity: Severity;
  link: string;
};

type OperationsExceptionsResponse = {
  generatedAt: string;
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
  items: ExceptionRow[];
};

const rowAccent: Record<Severity, CSSProperties> = {
  CRITICAL: { backgroundColor: "rgba(194, 58, 58, 0.14)" },
  WARNING: { backgroundColor: "rgba(214, 148, 34, 0.14)" },
  INFO: {},
};

const badgeClass: Record<Severity, string> = {
  CRITICAL: "status-badge status-cancelled",
  WARNING: "status-badge status-warning",
  INFO: "status-badge",
};

export const OperationsExceptionsPage = () => {
  const { error } = useToasts();
  const [report, setReport] = useState<OperationsExceptionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<Severity | "">("");

  const loadReport = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<OperationsExceptionsResponse>("/api/reports/operations/exceptions");
      setReport(payload);
    } catch (loadError) {
      setReport(null);
      error(loadError instanceof Error ? loadError.message : "Failed to load operations exceptions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleItems = useMemo(
    () => (severityFilter ? report?.items.filter((row) => row.severity === severityFilter) ?? [] : report?.items ?? []),
    [report, severityFilter],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Operations Exceptions</h1>
            <p className="muted-text">
              Single manager queue combining pricing, inventory, purchasing, workshop, and customer follow-up issues that already exist in CorePOS reporting.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadReport()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <Link to="/management">Management</Link>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">All Exceptions</span>
            <strong className="metric-value">{report?.summary.total ?? 0}</strong>
            <span className="dashboard-metric-detail">Combined operational attention items</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Critical</span>
            <strong className="metric-value">{report?.summary.critical ?? 0}</strong>
            <span className="dashboard-metric-detail">Immediate operational risk</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Warning</span>
            <strong className="metric-value">{report?.summary.warning ?? 0}</strong>
            <span className="dashboard-metric-detail">Should be reviewed soon</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Info</span>
            <strong className="metric-value">{report?.summary.info ?? 0}</strong>
            <span className="dashboard-metric-detail">Operational follow-up worth tracking</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Attention Queue</h2>
            <p className="muted-text">
              This page reuses current report heuristics. It is a manager triage surface, not a new workflow engine.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Severity
              <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as Severity | "")}>
                <option value="">All severities</option>
                <option value="CRITICAL">Critical</option>
                <option value="WARNING">Warning</option>
                <option value="INFO">Info</option>
              </select>
            </label>
            <Link to="/management/alerts">Alerts</Link>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Title</th>
                <th>Description</th>
                <th>Severity</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length ? visibleItems.map((row) => (
                <tr key={`${row.type}-${row.entityId}`} style={rowAccent[row.severity]}>
                  <td>{row.type}</td>
                  <td>{row.title}</td>
                  <td>{row.description}</td>
                  <td><span className={badgeClass[row.severity]}>{row.severity}</span></td>
                  <td><Link to={row.link}>Open</Link></td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5}>{loading ? "Loading operations exceptions..." : "No operations exceptions right now."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
