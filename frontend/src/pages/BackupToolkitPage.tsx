import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";

type LocationRow = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
};

const formatDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const toQueryString = (params: Record<string, string>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value.trim()) {
      query.set(key, value.trim());
    }
  });
  const result = query.toString();
  return result ? `?${result}` : "";
};

const commandRows = [
  {
    label: "Create PostgreSQL backup",
    command: "scripts/backup_database.sh [output-file]",
    detail: "Creates a custom-format pg_dump using the current DATABASE_URL before upgrades, trial resets, or risky maintenance.",
  },
  {
    label: "Reset local development database",
    command: "node scripts/reset_local_dev_db.js",
    detail: "Recreates the local development database from the current Prisma migration chain when drift is reported.",
  },
  {
    label: "Generate Prisma client",
    command: "npx prisma generate",
    detail: "Refreshes generated Prisma types after schema or migration work.",
  },
  {
    label: "Apply local dev migrations",
    command: "npx prisma migrate dev",
    detail: "Interactive local migration flow for development databases.",
  },
  {
    label: "Seed development data",
    command: "npm run db:seed:dev",
    detail: "Loads demo users, products, customers, jobs, and sales for local operation.",
  },
  {
    label: "Seed test data",
    command: "npm run db:seed:test",
    detail: "Loads test data against the `.env.test` database when the test environment is set up.",
  },
  {
    label: "Run a command against `.env.test`",
    command: "node scripts/run_with_test_env.js <command>",
    detail: "Executes a one-off command with the repository test environment loaded.",
  },
];

export const BackupToolkitPage = () => {
  const today = new Date();
  const defaultTo = formatDateKey(today);
  const defaultFrom = formatDateKey(shiftDays(today, -29));

  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [locationId, setLocationId] = useState("");
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

  const exportLinks = useMemo(() => ({
    salesDaily: `/api/reports/sales/daily.csv${toQueryString({ from: fromDate, to: toDate })}`,
    workshopDaily: `/api/reports/workshop/daily.csv${toQueryString({ from: fromDate, to: toDate })}`,
    inventoryOnHand: `/api/reports/inventory/on-hand.csv${toQueryString({ locationId })}`,
    inventoryValue: `/api/reports/inventory/value.csv${toQueryString({ locationId })}`,
  }), [fromDate, locationId, toDate]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Backup & Export Toolkit</h1>
            <p className="muted-text">
              Admin-facing toolkit for the export and recovery operations that already exist on this branch. This page does not create a new backup engine; it centralizes the supported download and recovery entry points.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management/exports">Full export hub</Link>
            <Link to="/management/settings">System settings</Link>
          </div>
        </div>

        <div className="filter-row">
          <label>
            From
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <label>
            Stock location
            <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">All locations</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name} ({location.code})</option>
              ))}
            </select>
          </label>
        </div>

        <div className="restricted-panel info-panel">
          This branch does not ship an automated in-app backup scheduler. Use the export hub for CSV extracts and `scripts/backup_database.sh` for a full PostgreSQL backup before maintenance or trial resets.
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Direct Export Entry Points</h2>
            <Link to="/management/exports">Open export hub</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Export</th>
                  <th>Description</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Sales Daily CSV</td>
                  <td>Daily sales totals across the selected date range.</td>
                  <td><a href={exportLinks.salesDaily}>Download</a></td>
                </tr>
                <tr>
                  <td>Workshop Daily CSV</td>
                  <td>Daily workshop completions and workshop revenue.</td>
                  <td><a href={exportLinks.workshopDaily}>Download</a></td>
                </tr>
                <tr>
                  <td>Inventory On-Hand CSV</td>
                  <td>Current on-hand snapshot, optionally by location.</td>
                  <td><a href={exportLinks.inventoryOnHand}>Download</a></td>
                </tr>
                <tr>
                  <td>Inventory Value CSV</td>
                  <td>Current inventory valuation snapshot.</td>
                  <td><a href={exportLinks.inventoryValue}>Download</a></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Operational Recovery Commands</h2>
            <Link to="/management/admin-review">Admin review</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Command</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>
                {commandRows.map((row) => (
                  <tr key={row.command}>
                    <td>{row.label}</td>
                    <td className="mono-text">{row.command}</td>
                    <td>{row.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Restore / Reset Guidance</h2>
            <Link to="/management/health">Ops health</Link>
          </div>
          <ul>
            <li>Use `.env` plus `npx prisma migrate dev` for local development setup.</li>
            <li>Use `scripts/backup_database.sh` before upgrades, resets, or any manual restore exercise.</li>
            <li>Use `node scripts/reset_local_dev_db.js` only for local development database drift.</li>
            <li>Use `npm run db:seed:dev` after resetting the local database to restore demo users and operational sample data.</li>
            <li>Use `node scripts/run_with_test_env.js` when a command must target the repository test environment.</li>
            <li>
              Restore a dump with{" "}
              <code>pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$DATABASE_URL" backup.dump</code>{" "}
              only when you intentionally want to overwrite the target database.
            </li>
          </ul>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Related Admin Tools</h2>
            <Link to="/management/settings">Settings overview</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Use</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Export Hub</td>
                  <td>Management CSV downloads and filtered export links.</td>
                  <td><Link to="/management/exports">Open</Link></td>
                </tr>
                <tr>
                  <td>Admin Review</td>
                  <td>Role visibility and recent admin activity.</td>
                  <td><Link to="/management/admin-review">Open</Link></td>
                </tr>
                <tr>
                  <td>Staff Management</td>
                  <td>User role, status, and password reset operations.</td>
                  <td><Link to="/management/staff">Open</Link></td>
                </tr>
                <tr>
                  <td>System Settings</td>
                  <td>Current operational defaults and admin control points.</td>
                  <td><Link to="/management/settings">Open</Link></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
