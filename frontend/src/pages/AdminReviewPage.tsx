import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type UserRole = "STAFF" | "MANAGER" | "ADMIN";

type StaffUser = {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  role: UserRole;
  isTechnician: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type UserListResponse = {
  users: StaffUser[];
};

type AuditEvent = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorRole: string | null;
  actorId: string | null;
  metadata: unknown;
  createdAt: string;
};

type AuditResponse = {
  events: AuditEvent[];
};

const sensitiveAreas = [
  { label: "Management dashboards and reporting", minimumRole: "MANAGER+", path: "/management" },
  { label: "Refund oversight and cash visibility", minimumRole: "MANAGER+", path: "/management/refunds" },
  { label: "Staff administration", minimumRole: "ADMIN", path: "/management/staff" },
  { label: "Admin review", minimumRole: "ADMIN", path: "/management/admin-review" },
];

const adminActions = new Set([
  "ADMIN_USER_CREATED",
  "ADMIN_USER_UPDATED",
  "ADMIN_USER_PASSWORD_RESET",
]);

const toMetadataPreview = (value: unknown) => {
  if (value === null || value === undefined) {
    return "-";
  }
  try {
    const text = JSON.stringify(value);
    return text.length > 110 ? `${text.slice(0, 107)}...` : text;
  } catch {
    return "[unavailable]";
  }
};

export const AdminReviewPage = () => {
  const { error } = useToasts();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const loadPage = async () => {
    setLoading(true);
    const [usersResult, eventsResult] = await Promise.allSettled([
      apiGet<UserListResponse>("/api/admin/users"),
      apiGet<AuditResponse>("/api/audit?limit=100"),
    ]);

    if (usersResult.status === "fulfilled") {
      setUsers(usersResult.value.users || []);
    } else {
      setUsers([]);
      error(usersResult.reason instanceof Error ? usersResult.reason.message : "Failed to load users");
    }

    if (eventsResult.status === "fulfilled") {
      setEvents(eventsResult.value.events || []);
    } else {
      setEvents([]);
      error(eventsResult.reason instanceof Error ? eventsResult.reason.message : "Failed to load audit activity");
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roleCounts = useMemo(() => ({
    staff: users.filter((user) => user.role === "STAFF").length,
    managers: users.filter((user) => user.role === "MANAGER").length,
    admins: users.filter((user) => user.role === "ADMIN").length,
    inactive: users.filter((user) => !user.isActive).length,
  }), [users]);

  const adminEvents = useMemo(
    () => events.filter((event) => adminActions.has(event.action) || event.actorRole === "ADMIN").slice(0, 20),
    [events],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Admin Review</h1>
            <p className="muted-text">
              Admin-facing review surface for current roles, sensitive access areas, and recent admin activity. This complements staff management instead of replacing it.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management/staff">Staff management</Link>
            <button type="button" onClick={() => void loadPage()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Staff Users</span>
            <strong className="metric-value">{roleCounts.staff}</strong>
            <span className="dashboard-metric-detail">Standard operational access</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Managers</span>
            <strong className="metric-value">{roleCounts.managers}</strong>
            <span className="dashboard-metric-detail">Management and oversight access</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Admins</span>
            <strong className="metric-value">{roleCounts.admins}</strong>
            <span className="dashboard-metric-detail">Highest privilege on current role model</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Inactive Users</span>
            <strong className="metric-value">{roleCounts.inactive}</strong>
            <span className="dashboard-metric-detail">Accounts currently disabled</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>User & Role Overview</h2>
            <Link to="/management/staff">Open staff management</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No users available.</td>
                  </tr>
                ) : users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name || user.email || "-"}</td>
                    <td>{user.username}</td>
                    <td><span className="status-badge">{user.role}</span></td>
                    <td><span className={user.isActive ? "status-badge status-complete" : "status-badge status-cancelled"}>{user.isActive ? "Active" : "Inactive"}</span></td>
                    <td>{new Date(user.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Sensitive Areas</h2>
            <Link to="/management/activity">Audit activity</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Area</th>
                  <th>Current minimum role</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {sensitiveAreas.map((area) => (
                  <tr key={area.path}>
                    <td>{area.label}</td>
                    <td>{area.minimumRole}</td>
                    <td><Link to={area.path}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Recent Admin Activity</h2>
            <Link to="/management/activity">Full activity feed</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Entity</th>
                  <th>Metadata</th>
                </tr>
              </thead>
              <tbody>
                {adminEvents.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No recent admin activity is visible.</td>
                  </tr>
                ) : adminEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.createdAt).toLocaleString()}</td>
                    <td>{event.action}</td>
                    <td>{[event.actorRole, event.actorId].filter(Boolean).join(" / ") || "-"}</td>
                    <td>{[event.entityType, event.entityId].filter(Boolean).join(" / ") || "-"}</td>
                    <td><span className="mono-text">{toMetadataPreview(event.metadata)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
