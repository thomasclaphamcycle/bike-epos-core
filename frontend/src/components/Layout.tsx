import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "./ToastProvider";
import { GlobalCommandBar } from "./GlobalCommandBar";
import CorePosLogo from "./branding/CorePosLogo";
import { appVersionLabel } from "../utils/buildInfo";
import {
  canAccessNavigationRole,
  matchesNavigationPath,
  navigationSections,
} from "../navigation/navigationConfig";

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
  const visibleSections = useMemo(() => (
    navigationSections
      .filter((section) => canAccessNavigationRole(user?.role, section.minimumRole))
      .map((section) => ({
        ...section,
        items: section.items?.filter((item) => canAccessNavigationRole(user?.role, item.minimumRole)),
      }))
  ), [user?.role]);

  const isSectionActive = (section: typeof visibleSections[number]) =>
    matchesNavigationPath(currentPath, section)
    || Boolean(section.items?.some((item) => item.kind === "link" && matchesNavigationPath(currentPath, item)));

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setOpenSections((current) => {
      const next = { ...current };
      for (const section of visibleSections) {
        if (!section.items?.length) {
          continue;
        }
        if (next[section.id] === undefined) {
          next[section.id] = Boolean(section.defaultExpanded || isSectionActive(section));
          continue;
        }
        if (isSectionActive(section)) {
          next[section.id] = true;
        }
      }
      return next;
    });
  }, [currentPath, visibleSections]);

  const activeArea = visibleSections.find((section) => isSectionActive(section))?.label ?? "Dashboard";

  return (
    <div className="layout-root">
      <aside className="app-sidebar">
        <div className="sidebar-brand-block">
          <Link to="/dashboard" className="brand" aria-label="CorePOS dashboard">
            <CorePosLogo variant="full" size={60} className="sidebar-brand-logo" />
          </Link>
        </div>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          <section className="sidebar-section">
            <div className="sidebar-link-list">
              {visibleSections.map((section) => {
                const hasChildren = Boolean(section.items?.length);
                const isActive = isSectionActive(section);
                const isOpen = hasChildren ? Boolean(openSections[section.id]) : false;
                const submenuId = `sidebar-submenu-${section.id}`;

                return (
                  <div
                    key={section.id}
                    className={isActive ? "sidebar-section-item sidebar-section-item--active" : "sidebar-section-item"}
                  >
                    {hasChildren ? (
                      <button
                        type="button"
                        className={isActive ? "sidebar-link sidebar-link--active sidebar-link--expandable" : "sidebar-link sidebar-link--expandable"}
                        aria-expanded={isOpen}
                        aria-controls={submenuId}
                        data-testid={`nav-toggle-${section.id}`}
                        onClick={() => {
                          setOpenSections((current) => ({
                            ...current,
                            [section.id]: !current[section.id],
                          }));
                        }}
                      >
                        <span className="sidebar-link-label">{section.label}</span>
                        <span
                          aria-hidden="true"
                          className={isOpen ? "sidebar-toggle-chevron sidebar-toggle-chevron--open" : "sidebar-toggle-chevron"}
                        >
                          ▸
                        </span>
                      </button>
                    ) : (
                      <div className="sidebar-section-row">
                        <NavLink
                          to={section.to}
                          end
                          className={isActive ? "sidebar-link sidebar-link--active" : "sidebar-link"}
                        >
                          {section.label}
                        </NavLink>
                      </div>
                    )}

                    {hasChildren && isOpen ? (
                      <div id={submenuId} className="sidebar-submenu">
                        {section.items?.map((item) => {
                          if (item.kind === "label") {
                            return (
                              <div key={`${section.id}-${item.label}`} className="sidebar-subgroup-label">
                                {item.label}
                              </div>
                            );
                          }

                          return (
                            <NavLink
                              key={item.to}
                              to={item.to}
                              end
                              className={matchesNavigationPath(currentPath, item)
                                ? "sidebar-submenu-link sidebar-submenu-link--active"
                                : "sidebar-submenu-link"}
                            >
                              {item.label}
                            </NavLink>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </nav>

        <div className="sidebar-build-info">{appVersionLabel}</div>
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
