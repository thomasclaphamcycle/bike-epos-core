import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "./ToastProvider";

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "nav-link nav-link-active" : "nav-link";

const envLabel = import.meta.env.MODE || "development";

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const { user, logout } = useAuth();
  const { error, success } = useToasts();
  const navigate = useNavigate();

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

  return (
    <div className="layout-root">
      <header className="app-header">
        <div className="header-left">
          <Link to="/pos" className="brand">CorePOS</Link>
          <nav className="nav-links">
            <NavLink to="/pos" className={navClass}>POS</NavLink>
            <NavLink to="/workshop" className={navClass}>Workshop</NavLink>
            <NavLink to="/customers" className={navClass}>Customers</NavLink>
          </nav>
        </div>
        <div className="header-right">
          <span className="user-chip">{user?.username} ({user?.role})</span>
          <button type="button" onClick={onLogout}>Logout</button>
        </div>
      </header>

      <main className="app-main">{children}</main>

      <footer className="app-footer">
        <span>Environment: {envLabel}</span>
      </footer>
    </div>
  );
};
