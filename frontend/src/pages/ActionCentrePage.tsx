import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { ReportSeverity, reportSeverityBadgeClass, reportSeverityRowAccent } from "../utils/reportSeverity";

type ActionItem = {
  type: string;
  entityId: string;
  title: string;
  reason: string;
  severity: ReportSeverity;
  link: string;
};

type ActionSection = {
  key: string;
  title: string;
  description: string;
  itemCount: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  items: ActionItem[];
};

type ActionCentreResponse = {
  generatedAt: string;
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    sectionCount: number;
    sectionsWithItems: number;
  };
  sections: ActionSection[];
};

export const ActionCentrePage = () => {
  const { error } = useToasts();
  const [report, setReport] = useState<ActionCentreResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<ReportSeverity | "">("");

  const loadReport = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<ActionCentreResponse>("/api/reports/operations/actions");
      setReport(payload);
    } catch (loadError) {
      setReport(null);
      error(loadError instanceof Error ? loadError.message : "Failed to load action centre");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleSections = useMemo(
    () => (report?.sections ?? []).map((section) => ({
      ...section,
      items: severityFilter
        ? section.items.filter((item) => item.severity === severityFilter)
        : section.items,
    })),
    [report?.sections, severityFilter],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Action Centre</h1>
            <p className="muted-text">
              One grouped manager queue across purchasing, workshop, pricing, inventory, and customer follow-up. Review the reason here, then handle the work in the linked operational screen.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadReport()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <Link to="/management/investigations">Stock Investigations</Link>
            <Link to="/management/exceptions">Exceptions</Link>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Open Actions</span>
            <strong className="metric-value">{report?.summary.total ?? 0}</strong>
            <span className="dashboard-metric-detail">Grouped operational attention items</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Critical</span>
            <strong className="metric-value">{report?.summary.critical ?? 0}</strong>
            <span className="dashboard-metric-detail">Immediate manager action</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Warning</span>
            <strong className="metric-value">{report?.summary.warning ?? 0}</strong>
            <span className="dashboard-metric-detail">Follow up soon</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Sections Active</span>
            <strong className="metric-value">{report?.summary.sectionsWithItems ?? 0}</strong>
            <span className="dashboard-metric-detail">Out of {report?.summary.sectionCount ?? 0} operational areas</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Grouped Actions</h2>
            <p className="muted-text">
              This page consolidates current report outputs into practical manager sections. It does not create or assign tasks, so the next step is always to open the linked page and action the item there.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Severity
              <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as ReportSeverity | "")}>
                <option value="">All severities</option>
                <option value="CRITICAL">CRITICAL</option>
                <option value="WARNING">WARNING</option>
                <option value="INFO">INFO</option>
              </select>
            </label>
            <Link to="/management/investigations">Investigations</Link>
            <Link to="/management">Management</Link>
          </div>
        </div>
      </section>

      {visibleSections.map((section) => (
        <section className="card" key={section.key}>
          <div className="card-header-row">
            <div>
              <h2>{section.title}</h2>
              <p className="muted-text">{section.description}</p>
            </div>
            <div className="actions-inline">
              <span className="status-badge">{section.itemCount} items</span>
              <span className="status-badge status-cancelled">{section.criticalCount} critical</span>
              <span className="status-badge status-warning">{section.warningCount} warning</span>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Reason</th>
                  <th>Severity</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {section.items.length ? section.items.map((item) => (
                  <tr key={`${item.type}-${item.entityId}`} style={reportSeverityRowAccent[item.severity]}>
                    <td>{item.title}</td>
                    <td>{item.reason}</td>
                    <td><span className={reportSeverityBadgeClass[item.severity]}>{item.severity}</span></td>
                    <td><Link to={item.link}>Open</Link></td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4}>
                      {loading
                        ? `Loading ${section.title.toLowerCase()} actions...`
                        : `No ${section.title.toLowerCase()} actions right now. Use the linked area for a manual review if you still need to check this section.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
};
