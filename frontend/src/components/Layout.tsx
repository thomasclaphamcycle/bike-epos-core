import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "./ToastProvider";
import { GlobalCommandBar } from "./GlobalCommandBar";

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "nav-link nav-link-active" : "nav-link";

const envLabel = import.meta.env.MODE || "development";
const isManagerPlus = (role: string | undefined) => role === "MANAGER" || role === "ADMIN";
const isAdmin = (role: string | undefined) => role === "ADMIN";

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const { user, logout } = useAuth();
  const { error, success } = useToasts();
  const navigate = useNavigate();
  const canViewManagement = isManagerPlus(user?.role);
  const canViewStaffAdmin = isAdmin(user?.role);

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
          <Link to="/home" className="brand">CorePOS</Link>
          <nav className="nav-links">
            <NavLink to="/dashboard" className={navClass}>Dashboard</NavLink>
            {canViewManagement ? <NavLink to="/management" className={navClass}>Management</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/alerts" className={navClass}>Alerts</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/summary" className={navClass}>Ops Summary</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/trade-close" className={navClass}>Trade Close</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/liabilities" className={navClass}>Liabilities</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/activity" className={navClass}>Activity</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/cash" className={navClass}>Cash</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/refunds" className={navClass}>Refunds</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/reminders" className={navClass}>Reminders</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/communications" className={navClass}>Comms Queue</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/health" className={navClass}>Ops Health</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/integrity" className={navClass}>Integrity</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/warranty" className={navClass}>Warranty</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/supplier-returns" className={navClass}>Supplier Returns</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/stock-exceptions" className={navClass}>Stock Exceptions</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/transfers" className={navClass}>Transfers</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/sales" className={navClass}>Sales</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/workshop" className={navClass}>Workshop Metrics</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/staff-performance" className={navClass}>Staff Perf</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/workshop-ageing" className={navClass}>Workshop Ageing</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/calendar" className={navClass}>Calendar</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/products" className={navClass}>Products</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/pricing" className={navClass}>Pricing</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/customers" className={navClass}>Customer Insights</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/inventory" className={navClass}>Inventory Intel</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/suppliers" className={navClass}>Supplier Perf</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/catalogue" className={navClass}>Catalogue</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/product-data" className={navClass}>Product Data</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/reordering" className={navClass}>Reordering</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/capacity" className={navClass}>Capacity</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/purchasing" className={navClass}>PO Action</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/views" className={navClass}>Saved Views</NavLink> : null}
            {canViewManagement ? <NavLink to="/management/exports" className={navClass}>Exports</NavLink> : null}
            {canViewStaffAdmin ? <NavLink to="/management/staff" className={navClass}>Staff Admin</NavLink> : null}
            {canViewStaffAdmin ? <NavLink to="/management/admin-review" className={navClass}>Admin Review</NavLink> : null}
            {canViewStaffAdmin ? <NavLink to="/management/backups" className={navClass}>Backups</NavLink> : null}
            {canViewStaffAdmin ? <NavLink to="/management/settings" className={navClass}>Settings</NavLink> : null}
            <NavLink to="/pos" className={navClass}>POS</NavLink>
            <NavLink to="/workshop" className={navClass}>Workshop</NavLink>
            <NavLink to="/workshop/check-in" className={navClass}>Check-In</NavLink>
            <NavLink to="/workshop/bookings" className={navClass}>Bookings</NavLink>
            <NavLink to="/workshop/collection" className={navClass}>Collection</NavLink>
            <NavLink to="/workshop/print" className={navClass}>Print Centre</NavLink>
            <NavLink to="/tasks" className={navClass}>Tasks</NavLink>
            <NavLink to="/customers" className={navClass}>Customers</NavLink>
            <NavLink to="/inventory" className={navClass}>Inventory</NavLink>
            <NavLink to="/inventory/locations" className={navClass}>Inv. Locations</NavLink>
            <NavLink to="/suppliers" className={navClass}>Suppliers</NavLink>
            <NavLink to="/purchasing" className={navClass}>Purchasing</NavLink>
            <NavLink to="/purchasing/receiving" className={navClass}>Receiving</NavLink>
          </nav>
        </div>
        <div className="header-right">
          <GlobalCommandBar />
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
