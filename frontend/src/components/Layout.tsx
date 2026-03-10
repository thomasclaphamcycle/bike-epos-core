import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "./ToastProvider";
import { GlobalCommandBar } from "./GlobalCommandBar";
import { toRoleHomeRoute } from "../utils/homeRoute";
import CorePosLogo from "./branding/CorePosLogo";

type NavEntry = {
  label: string;
  to: string;
};

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "nav-link nav-link-active" : "nav-link";

const envLabel = import.meta.env.MODE || "development";
const isManagerPlus = (role: string | undefined) => role === "MANAGER" || role === "ADMIN";
const isAdmin = (role: string | undefined) => role === "ADMIN";

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const { user, logout } = useAuth();
  const { error, success } = useToasts();
  const navigate = useNavigate();
  const location = useLocation();
  const canViewManagement = isManagerPlus(user?.role);
  const canViewStaffAdmin = isAdmin(user?.role);
  const homePath = toRoleHomeRoute(user?.role);

  const primaryNav = useMemo<NavEntry[]>(() => [
    { label: "Home", to: homePath },
    { label: "POS", to: "/pos" },
    { label: "Workshop", to: "/workshop" },
    { label: "Inventory", to: "/inventory" },
    { label: "Purchasing", to: "/purchasing" },
    { label: "Customers", to: "/customers" },
    { label: "Tasks", to: "/tasks" },
  ], [homePath]);

  const workshopNav: NavEntry[] = [
    { label: "Check-In", to: "/workshop/check-in" },
    { label: "Bookings", to: "/workshop/bookings" },
    { label: "Collection", to: "/workshop/collection" },
    { label: "Print Centre", to: "/workshop/print" },
  ];

  const inventoryNav: NavEntry[] = [
    { label: "Stock by Location", to: "/inventory/locations" },
    { label: "Receiving", to: "/purchasing/receiving" },
    { label: "Suppliers", to: "/suppliers" },
  ];

  const managementCore: NavEntry[] = [
    { label: "Overview", to: "/management" },
    { label: "Alerts", to: "/management/alerts" },
    { label: "Trade Close", to: "/management/trade-close" },
    { label: "Operations Summary", to: "/management/summary" },
    { label: "Ops Health", to: "/management/health" },
  ];

  const managementReports: NavEntry[] = [
    { label: "Sales", to: "/management/sales" },
    { label: "Workshop", to: "/management/workshop" },
    { label: "Customers", to: "/management/customers" },
    { label: "Products", to: "/management/products" },
    { label: "Inventory", to: "/management/inventory" },
    { label: "Suppliers", to: "/management/suppliers" },
    { label: "Staff Activity", to: "/management/staff-performance" },
    { label: "Cash", to: "/management/cash" },
    { label: "Refunds", to: "/management/refunds" },
    { label: "Liabilities", to: "/management/liabilities" },
  ];

  const managementQueues: NavEntry[] = [
    { label: "Purchase Orders", to: "/management/purchasing" },
    { label: "Reordering", to: "/management/reordering" },
    { label: "Transfers", to: "/management/transfers" },
    { label: "Capacity", to: "/management/capacity" },
    { label: "Calendar", to: "/management/calendar" },
    { label: "Workshop Ageing", to: "/management/workshop-ageing" },
    { label: "Reminders", to: "/management/reminders" },
    { label: "Communications", to: "/management/communications" },
    { label: "Warranty", to: "/management/warranty" },
    { label: "Pricing", to: "/management/pricing" },
    { label: "Product Data", to: "/management/product-data" },
    { label: "Catalogue", to: "/management/catalogue" },
    { label: "Stock Exceptions", to: "/management/stock-exceptions" },
    { label: "Supplier Returns", to: "/management/supplier-returns" },
    { label: "Integrity", to: "/management/integrity" },
  ];

  const managementTools: NavEntry[] = [
    { label: "Saved Views", to: "/management/views" },
    { label: "Exports", to: "/management/exports" },
    { label: "Docs", to: "/management/docs" },
  ];

  const adminNav: NavEntry[] = [
    { label: "Staff Admin", to: "/management/staff" },
    { label: "Admin Review", to: "/management/admin-review" },
    { label: "Onboarding", to: "/management/onboarding" },
    { label: "Backups", to: "/management/backups" },
    { label: "Settings", to: "/management/settings" },
  ];

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

  const renderNavList = (items: NavEntry[], compact = false) => (
    <div className={compact ? "sidebar-link-list sidebar-link-list-compact" : "sidebar-link-list"}>
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} className={navClass}>
          {item.label}
        </NavLink>
      ))}
    </div>
  );

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
            <CorePosLogo variant="full" size={36} className="sidebar-brand-logo" />
          </Link>
        </div>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          <section className="sidebar-section">
            <span className="sidebar-section-label">Daily Work</span>
            {renderNavList(primaryNav)}
          </section>

          <section className="sidebar-section">
            <span className="sidebar-section-label">Workshop</span>
            {renderNavList(workshopNav, true)}
          </section>

          <section className="sidebar-section">
            <span className="sidebar-section-label">Inventory & Buying</span>
            {renderNavList(inventoryNav, true)}
          </section>

          {canViewManagement ? (
            <>
              <section className="sidebar-section">
                <span className="sidebar-section-label">Management</span>
                {renderNavList(managementCore)}
              </section>

              <section className="sidebar-section">
                <span className="sidebar-section-label">Reports</span>
                {renderNavList(managementReports, true)}
              </section>

              <section className="sidebar-section">
                <span className="sidebar-section-label">Queues & Control</span>
                {renderNavList(managementQueues, true)}
              </section>

              <section className="sidebar-section">
                <span className="sidebar-section-label">Management Tools</span>
                {renderNavList(managementTools, true)}
              </section>
            </>
          ) : null}

          {canViewStaffAdmin ? (
            <section className="sidebar-section">
              <span className="sidebar-section-label">Admin</span>
              {renderNavList(adminNav, true)}
            </section>
          ) : null}
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
