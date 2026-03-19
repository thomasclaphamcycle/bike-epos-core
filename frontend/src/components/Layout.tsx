import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "./ToastProvider";
import CorePosLogo from "./branding/CorePosLogo";
import { useRuntimeVersionLabel } from "../hooks/useRuntimeVersionLabel";
import {
  canAccessNavigationRole,
  matchesNavigationPath,
  navigationSections,
} from "../navigation/navigationConfig";

const envLabel = import.meta.env.MODE || "development";

const workspacePagePrefixes = [
  "/dashboard",
  "/management/staff-rota",
  "/pos",
];

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const { user, logout } = useAuth();
  const { error, success } = useToasts();
  const navigate = useNavigate();
  const location = useLocation();
  const appVersionLabel = useRuntimeVersionLabel();

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
  const isWorkspacePage = workspacePagePrefixes.some((prefix) => currentPath.startsWith(prefix));
  const visibleSections = useMemo(() => (
    navigationSections
      .filter((section) => canAccessNavigationRole(user?.role, section.minimumRole))
      .map((section) => ({
        ...section,
        items: section.items?.filter((item) => canAccessNavigationRole(user?.role, item.minimumRole)),
      }))
  ), [user?.role]);

  const getActiveChild = (section: typeof visibleSections[number]) => {
    const matchingChild = section.items?.find(
      (item) => item.kind === "link" && matchesNavigationPath(currentPath, item),
    );

    if (matchingChild || !matchesNavigationPath(currentPath, section)) {
      return matchingChild;
    }

    return section.items?.find(
      (item) => item.kind === "link" && item.to === section.to,
    );
  };

  const isSectionActive = (section: typeof visibleSections[number]) =>
    matchesNavigationPath(currentPath, section)
    || Boolean(getActiveChild(section));

  const isSectionDirectlyActive = (section: typeof visibleSections[number]) =>
    matchesNavigationPath(currentPath, section) && !getActiveChild(section);

  const [openSectionId, setOpenSectionId] = useState<string | null>(null);

  useEffect(() => {
    const activeExpandableSectionId = visibleSections.find(
      (section) => section.items?.length && isSectionActive(section),
    )?.id ?? null;

    setOpenSectionId((current) => {
      if (activeExpandableSectionId) {
        return activeExpandableSectionId;
      }

      if (
        current
        && visibleSections.some((section) => section.id === current && section.items?.length)
      ) {
        return current;
      }

      return null;
    });
  }, [currentPath, visibleSections]);

  const userDisplayName = user?.name || user?.username || "Signed in";

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
                const isDirectlyActive = isSectionDirectlyActive(section);
                const isOpen = hasChildren ? openSectionId === section.id : false;
                const submenuId = `sidebar-submenu-${section.id}`;

                return (
                  <div
                    key={section.id}
                    className={isOpen ? "sidebar-section-item sidebar-section-item--open" : "sidebar-section-item"}
                  >
                    {hasChildren ? (
                      <div
                        className={isActive
                          ? "sidebar-section-row sidebar-section-row--split sidebar-section-row--group sidebar-section-row--group-active"
                          : "sidebar-section-row sidebar-section-row--split sidebar-section-row--group"}
                      >
                        <NavLink
                          to={section.to}
                          end
                          className="sidebar-link sidebar-link--group"
                        >
                          <span className="sidebar-link-label">{section.label}</span>
                        </NavLink>
                        <button
                          type="button"
                          className="sidebar-group-toggle"
                          aria-label={`${isOpen ? "Collapse" : "Expand"} ${section.label}`}
                          aria-expanded={isOpen}
                          aria-controls={submenuId}
                          data-testid={`nav-toggle-${section.id}`}
                          onClick={() => {
                            setOpenSectionId((current) => (current === section.id ? null : section.id));
                          }}
                        >
                          <span
                            aria-hidden="true"
                            className={isOpen ? "sidebar-toggle-chevron sidebar-toggle-chevron--open" : "sidebar-toggle-chevron"}
                          >
                            <svg viewBox="0 0 12 12" focusable="false" aria-hidden="true">
                              <path d="M4 2.5L8 6L4 9.5" />
                            </svg>
                          </span>
                        </button>
                      </div>
                    ) : (
                      <div className="sidebar-section-row">
                        <NavLink
                          to={section.to}
                          end
                          className={isDirectlyActive ? "sidebar-link sidebar-link--active" : "sidebar-link"}
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

        <div className="sidebar-footer">
          <div className="sidebar-account-block">
            <div className="sidebar-account-name">{userDisplayName}</div>
            <div className="sidebar-account-role">{user?.role}</div>
          </div>
          <button type="button" className="sidebar-logout-button" onClick={onLogout}>Logout</button>
          <div className="sidebar-build-info">{appVersionLabel}</div>
        </div>
      </aside>

      <div className="app-shell">
        <div className={currentPath.startsWith("/pos")
          ? "app-content-pane app-content-pane--pos"
          : "app-content-pane"}
        >
          <main className={currentPath.startsWith("/pos")
            ? "app-main app-main--workspace app-main--pos"
            : isWorkspacePage
              ? "app-main app-main--workspace"
              : "app-main"}
          >
            {children}
          </main>
        </div>

        <footer className="app-footer">
          <span>Environment: {envLabel}</span>
        </footer>
      </div>
    </div>
  );
};
