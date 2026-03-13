import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPatch } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type LocationRow = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
};

type ShopSettings = {
  store: {
    name: string;
    email: string;
    phone: string;
  };
  pos: {
    defaultTaxRatePercent: number;
    barcodeSearchAutoFocus: boolean;
  };
  workshop: {
    defaultJobDurationMinutes: number;
    defaultDepositPence: number;
  };
  operations: {
    lowStockThreshold: number;
  };
};

type SettingsResponse = {
  settings: ShopSettings;
};

const envLabel = import.meta.env.MODE || "development";

export const SystemSettingsPage = () => {
  const { error, success } = useToasts();
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    void (async () => {
      try {
        const payload = await apiGet<SettingsResponse>("/api/settings");
        setSettings(payload.settings);
      } catch (loadError) {
        error(loadError instanceof Error ? loadError.message : "Failed to load persisted settings");
      }
    })();
  }, [error]);

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

  const updateSettings = async (patch: Partial<ShopSettings>) => {
    setSaving(true);
    try {
      const payload = await apiPatch<SettingsResponse>("/api/settings", patch);
      setSettings(payload.settings);
      success("System settings updated.");
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to update settings");
    } finally {
      setSaving(false);
    }
  };

  const setStoreField = <K extends keyof ShopSettings["store"]>(key: K, value: ShopSettings["store"][K]) => {
    setSettings((current) => (current ? {
      ...current,
      store: {
        ...current.store,
        [key]: value,
      },
    } : current));
  };

  const setPosField = <K extends keyof ShopSettings["pos"]>(key: K, value: ShopSettings["pos"][K]) => {
    setSettings((current) => (current ? {
      ...current,
      pos: {
        ...current.pos,
        [key]: value,
      },
    } : current));
  };

  const setWorkshopField = <K extends keyof ShopSettings["workshop"]>(key: K, value: ShopSettings["workshop"][K]) => {
    setSettings((current) => (current ? {
      ...current,
      workshop: {
        ...current.workshop,
        [key]: value,
      },
    } : current));
  };

  const setOperationsField = <K extends keyof ShopSettings["operations"]>(key: K, value: ShopSettings["operations"][K]) => {
    setSettings((current) => (current ? {
      ...current,
      operations: {
        ...current.operations,
        [key]: value,
      },
    } : current));
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>System Settings</h1>
            <p className="muted-text">
              Manager-facing control panel for persisted shop defaults plus the existing governance and operational entry points already supported on this branch.
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
            <strong className="metric-value">{settings ? 4 : 3}</strong>
            <span className="dashboard-metric-detail">Staff admin, admin review, and system settings now persist real operational defaults</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Local Preference Surfaces</span>
            <strong className="metric-value">2</strong>
            <span className="dashboard-metric-detail">Dashboard widgets and saved views persist locally only</span>
          </div>
        </div>

        <div className="restricted-panel info-panel">
          CorePOS now stores a small persisted settings set for shop metadata and operational defaults. Existing specialist controls such as dashboard widgets, saved views, staff admin, bookings, and backups still keep their current dedicated surfaces.
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Persisted Shop Defaults</h2>
            <p className="muted-text">
              These settings are stored in CorePOS and give future POS, workshop, and management workflows a single configuration source instead of scattering new hardcoded defaults.
            </p>
          </div>
          {settings ? (
            <button
              type="button"
              className="primary"
              onClick={() => void updateSettings(settings)}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save settings"}
            </button>
          ) : null}
        </div>

        {!settings ? (
          <p className="muted-text">Loading persisted settings...</p>
        ) : (
          <div className="purchase-form-grid">
            <label>
              Store Name
              <input
                value={settings.store.name}
                onChange={(event) => setStoreField("name", event.target.value)}
                placeholder="Bike shop display name"
              />
            </label>
            <label>
              Store Email
              <input
                value={settings.store.email}
                onChange={(event) => setStoreField("email", event.target.value)}
                placeholder="contact@example.com"
              />
            </label>
            <label>
              Store Phone
              <input
                value={settings.store.phone}
                onChange={(event) => setStoreField("phone", event.target.value)}
                placeholder="01234 567890"
              />
            </label>
            <label>
              Default Tax Rate %
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={settings.pos.defaultTaxRatePercent}
                onChange={(event) => setPosField("defaultTaxRatePercent", Number(event.target.value))}
              />
            </label>
            <label>
              Workshop Default Minutes
              <input
                type="number"
                min="15"
                max="480"
                step="5"
                value={settings.workshop.defaultJobDurationMinutes}
                onChange={(event) => setWorkshopField("defaultJobDurationMinutes", Number(event.target.value))}
              />
            </label>
            <label>
              Workshop Default Deposit (pence)
              <input
                type="number"
                min="0"
                max="100000"
                step="50"
                value={settings.workshop.defaultDepositPence}
                onChange={(event) => setWorkshopField("defaultDepositPence", Number(event.target.value))}
              />
            </label>
            <label>
              Low Stock Threshold
              <input
                type="number"
                min="0"
                max="1000"
                step="1"
                value={settings.operations.lowStockThreshold}
                onChange={(event) => setOperationsField("lowStockThreshold", Number(event.target.value))}
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.pos.barcodeSearchAutoFocus}
                onChange={(event) => setPosField("barcodeSearchAutoFocus", event.target.checked)}
              />
              <span>Keep POS barcode/search workflows autofocus-friendly</span>
            </label>
          </div>
        )}
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
