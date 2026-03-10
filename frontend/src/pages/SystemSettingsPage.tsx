import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";

type LocationRow = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
};

const envLabel = import.meta.env.MODE || "development";

export const SystemSettingsPage = () => {
  const [locations, setLocations] = useState<LocationRow[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const payload = await apiGet<LocationRow[]>("/api/locations");
        setLocations(payload || []);
      } catch {
        setLocations([]);
      }
    })();
  }, []);

  const operationalControlPoints = useMemo(() => [
    {
      label: "Role-tailored home routing",
      currentState: "In app",
      detail: "Staff lands on /dashboard, managers on /management, admins on /management/staff.",
      path: "/home",
    },
    {
      label: "Management dashboard widgets",
      currentState: "Browser-local",
      detail: "Manager widget visibility and order are stored locally in the browser.",
      path: "/management/dashboard-settings",
    },
    {
      label: "Saved management views",
      currentState: "Browser-local",
      detail: "Saved filters/views are stored locally per signed-in user on this device.",
      path: "/management/views",
    },
    {
      label: "User roles and admin governance",
      currentState: "Persisted in app",
      detail: "Role assignments and account state are managed through current admin endpoints.",
      path: "/management/staff",
    },
    {
      label: "Backup/export toolkit",
      currentState: "Operational guidance",
      detail: "Exports are available in-app; backup/reset guidance remains documentation and script-driven.",
      path: "/management/backups",
    },
  ], []);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>System Settings</h1>
            <p className="muted-text">
              Admin-facing overview of the current operational defaults, control points, and governance links already supported by this branch. This is intentionally a truthful control panel, not a new persisted settings framework.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management/admin-review">Admin review</Link>
            <Link to="/management/backups">Backup toolkit</Link>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Frontend Mode</span>
            <strong className="metric-value">{envLabel}</strong>
            <span className="dashboard-metric-detail">Current Vite/runtime mode label</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Locations</span>
            <strong className="metric-value">{locations.length}</strong>
            <span className="dashboard-metric-detail">Store/location contexts visible to the app</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Persisted Admin Tools</span>
            <strong className="metric-value">2</strong>
            <span className="dashboard-metric-detail">Staff management and admin review currently change real app state</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Local Preference Surfaces</span>
            <strong className="metric-value">2</strong>
            <span className="dashboard-metric-detail">Dashboard widgets and saved views persist locally only</span>
          </div>
        </div>

        <div className="restricted-panel info-panel">
          No broad persisted settings model exists on this branch. Where clean controls do not already exist, this page centralizes the current defaults and the correct operational entry points instead of pretending those settings are editable.
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Role-Aware Home Defaults</h2>
            <Link to="/home">Test home routing</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Current landing route</th>
                  <th>Operational intent</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>STAFF</td>
                  <td className="mono-text">/dashboard</td>
                  <td>Operational home for POS, workshop, tasks, and day-to-day work.</td>
                </tr>
                <tr>
                  <td>MANAGER</td>
                  <td className="mono-text">/management</td>
                  <td>Management dashboard for oversight, reporting, and planning.</td>
                </tr>
                <tr>
                  <td>ADMIN</td>
                  <td className="mono-text">/management/staff</td>
                  <td>Immediate access to account, role, and governance operations.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Location & Store Context</h2>
            <Link to="/inventory/locations">Inventory by location</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Operational use</th>
                </tr>
              </thead>
              <tbody>
                {locations.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No locations are visible from the current API surface.</td>
                  </tr>
                ) : locations.map((location) => (
                  <tr key={location.id}>
                    <td>{location.name}</td>
                    <td className="mono-text">{location.code}</td>
                    <td><span className={location.isActive ? "status-badge status-complete" : "status-badge status-cancelled"}>{location.isActive ? "Active" : "Inactive"}</span></td>
                    <td>Used by stock visibility, replenishment, and inventory location views.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Operational Control Points</h2>
            <Link to="/management">Management</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Control</th>
                  <th>Current state</th>
                  <th>Meaning</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {operationalControlPoints.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.currentState}</td>
                    <td>{row.detail}</td>
                    <td><Link to={row.path}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Admin & Governance Tools</h2>
            <Link to="/management/staff">Staff admin</Link>
          </div>
          <ul>
            <li><Link to="/management/staff">Staff management</Link> is the current persisted user/role control surface.</li>
            <li><Link to="/management/admin-review">Admin review</Link> provides user/role overview plus recent sensitive admin activity.</li>
            <li><Link to="/management/backups">Backup toolkit</Link> centralizes export links and repo-supported reset/seed commands.</li>
            <li><Link to="/management/exports">Export hub</Link> remains the primary in-app download surface for current CSV/report endpoints.</li>
          </ul>
        </section>
      </div>
    </div>
  );
};
