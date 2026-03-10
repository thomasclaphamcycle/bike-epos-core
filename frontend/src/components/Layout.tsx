import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "./ToastProvider";
import { GlobalCommandBar } from "./GlobalCommandBar";
import CorePosLogo from "./branding/CorePosLogo";

const roleRank = {
  STAFF: 1,
  MANAGER: 2,
  ADMIN: 3,
} as const;

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "sidebar-link sidebar-link--active" : "sidebar-link";

const envLabel = import.meta.env.MODE || "development";

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const { user, logout } = useAuth();
  const { error, success } = useToasts();
  const navigate = useNavigate();
  const location = useLocation();

  const onLogout = async () => {
    try {
      await logout();
      success("Signed out");
      navigate("/login", { replace: true });
    } catch (logoutError) {
      const message = logoutError instanceof Error ? logoutError.message : "Logout failed";
      error(message);
    }
  };

  const currentPath = location.pathname;
  const sidebarNavItems = [
    { to: "/pos", label: "POS", minimumRole: "STAFF" },
    { to: "/management/products", label: "Products", minimumRole: "MANAGER" },
  ] as const;
  const visibleSidebarNavItems = sidebarNavItems.filter(
    (item) => user && roleRank[user.role] >= roleRank[item.minimumRole],
  );
  const activeArea = currentPath.startsWith("/management")
    ? "Management"
    : currentPath.startsWith("/workshop")
      ? "Workshop"
      : currentPath.startsWith("/inventory")
        ? "Inventory"
        : currentPath.startsWith("/purchasing") || currentPath.startsWith("/suppliers")
          ? "Purchasing"
          : currentPath.startsWith("/customers")
            ? "Customers"
            : currentPath.startsWith("/pos")
              ? "POS"
              : "Home";

  return (
    <div className="layout-root">
      <aside className="app-sidebar">
        <div className="sidebar-brand-block">
          <Link to="/home" className="brand" aria-label="CorePOS home">
            <CorePosLogo variant="full" size={60} className="sidebar-brand-logo" />
          </Link>
        </div>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          <section className="sidebar-section">
            <div className="sidebar-link-list">
              {visibleSidebarNavItems.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === "/pos"} className={navClass}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          </section>
        </nav>
      </aside>

      <div className="app-shell">
        <header className="app-header">
          <div className="header-left">
            <div className="header-context">
              <span className="header-eyebrow">Current Area</span>
              <strong className="header-area">{activeArea}</strong>
            </div>
            <div className="header-quick-actions">
              <Link to="/workshop/check-in" className="button-link">New Check-In</Link>
            </div>
          </div>
          <div className="header-right">
            <GlobalCommandBar />
            <span className="user-chip">{user?.username} ({user?.role})</span>
            <button type="button" className="logout-button" onClick={onLogout}>Logout</button>
          </div>
        </header>

        <main className="app-main">{children}</main>

        <footer className="app-footer">
          <span>Environment: {envLabel}</span>
        </footer>
      </div>
    </div>
  );
};
