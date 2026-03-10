import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "./ToastProvider";
import { GlobalCommandBar } from "./GlobalCommandBar";
import { toRoleHomeRoute } from "../utils/homeRoute";
import CorePosLogo from "./branding/CorePosLogo";

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "nav-link nav-link-active" : "nav-link";

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
              <NavLink to="/pos" end className={navClass}>
                POS
              </NavLink>
            </div>
          </section>
        </nav>
      </aside>

      <div className="app-shell">
        <header className="app-header">
          <div className="header-left">
            <Link to="/home" className="header-brand-link" aria-label="CorePOS home">
              <CorePosLogo variant="full" size={34} className="header-brand-logo" />
            </Link>
            <div className="header-context">
              <span className="header-eyebrow">Current Area</span>
              <strong className="header-area">{activeArea}</strong>
            </div>
            <div className="header-quick-actions">
              <Link to="/pos" className="button-link">Open POS</Link>
              <Link to="/workshop/check-in" className="button-link">New Check-In</Link>
            </div>
          </div>
          <div className="header-right">
            <GlobalCommandBar />
            <Link to="/account/pin" className="button-link">My PIN</Link>
            <span className="user-chip">{user?.username} ({user?.role})</span>
            <button type="button" onClick={onLogout}>Logout</button>
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
