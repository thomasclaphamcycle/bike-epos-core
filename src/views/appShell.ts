import { UserRole } from "@prisma/client";
import { escapeHtml } from "../utils/escapeHtml";

type AppShellUser = {
  id: string;
  username: string;
  name: string | null;
  role: UserRole;
};

type AppNavKey =
  | "pos"
  | "workshop"
  | "inventory"
  | "purchasing"
  | "receiving"
  | "till"
  | "manager-cash"
  | "manager-refunds"
  | "admin-users"
  | "admin-audit";

type AppShellInput = {
  html: string;
  title: string;
  user: AppShellUser;
  activeNav: AppNavKey;
};

const roleRank: Record<UserRole, number> = {
  STAFF: 1,
  MANAGER: 2,
  ADMIN: 3,
};

const navItems: Array<{
  key: AppNavKey;
  label: string;
  href: string;
  minRole: UserRole;
}> = [
  { key: "pos", label: "POS", href: "/pos", minRole: "STAFF" },
  { key: "workshop", label: "Workshop", href: "/workshop", minRole: "STAFF" },
  { key: "inventory", label: "Inventory", href: "/inventory", minRole: "STAFF" },
  { key: "purchasing", label: "Purchasing", href: "/purchasing", minRole: "MANAGER" },
  { key: "receiving", label: "Receiving", href: "/receiving", minRole: "MANAGER" },
  { key: "till", label: "Till / Cash Up", href: "/till", minRole: "MANAGER" },
  { key: "manager-cash", label: "Manager Cash", href: "/manager/cash", minRole: "MANAGER" },
  {
    key: "manager-refunds",
    label: "Manager Refunds",
    href: "/manager/refunds",
    minRole: "MANAGER",
  },
  { key: "admin-users", label: "Admin Users", href: "/admin", minRole: "ADMIN" },
  { key: "admin-audit", label: "Admin Audit", href: "/admin/audit", minRole: "ADMIN" },
];

const canView = (userRole: UserRole, minimumRole: UserRole) =>
  roleRank[userRole] >= roleRank[minimumRole];

const appShellStyles = `
  <style>
    .app-shell {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 230px 1fr;
      background: #eef2f6;
    }
    .app-shell-nav {
      border-right: 1px solid #d5dde6;
      background: #f7fafc;
      padding: 12px 10px;
      position: sticky;
      top: 0;
      height: 100vh;
      box-sizing: border-box;
      overflow-y: auto;
    }
    .app-shell-brand {
      font-size: 13px;
      color: #617080;
      margin-bottom: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .app-shell-nav-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    .app-shell-nav-item a {
      display: block;
      text-decoration: none;
      color: #213445;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid transparent;
      font-size: 14px;
      font-weight: 500;
    }
    .app-shell-nav-item a:hover {
      background: #edf3f8;
      border-color: #d5e0ea;
    }
    .app-shell-nav-item.active a {
      background: #0f6b8f;
      color: #fff;
      border-color: #0b5471;
    }
    .app-shell-main {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .app-shell-topbar {
      background: #fff;
      border-bottom: 1px solid #d5dde6;
      padding: 10px 16px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 20;
    }
    .app-shell-title {
      font-size: 16px;
      font-weight: 700;
      color: #1d2833;
    }
    .app-shell-user {
      display: flex;
      align-items: center;
      gap: 10px;
      color: #5f6e7d;
      font-size: 13px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .app-shell-logout {
      border: 1px solid #ccd8e3;
      background: #f7fafc;
      color: #243648;
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 13px;
      cursor: pointer;
    }
    .app-shell-content {
      min-width: 0;
      padding: 12px;
    }
    @media (max-width: 980px) {
      .app-shell {
        grid-template-columns: 1fr;
      }
      .app-shell-nav {
        position: static;
        height: auto;
        border-right: none;
        border-bottom: 1px solid #d5dde6;
        padding: 8px 10px;
      }
      .app-shell-nav-list {
        display: flex;
        flex-wrap: wrap;
      }
      .app-shell-nav-item a {
        padding: 6px 9px;
        font-size: 13px;
      }
      .app-shell-topbar {
        position: static;
      }
      .app-shell-content {
        padding: 10px 6px;
      }
    }
  </style>
`;

const appShellScript = `
  <script>
    (() => {
      const logoutBtn = document.getElementById("app-shell-logout");
      if (!logoutBtn) return;
      logoutBtn.addEventListener("click", async () => {
        try {
          await fetch("/api/auth/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
        } catch {}
        window.location.assign("/login");
      });
    })();
  </script>
`;

const renderNav = (userRole: UserRole, activeNav: AppNavKey) => {
  const links = navItems
    .filter((item) => canView(userRole, item.minRole))
    .map((item) => {
      const activeClass = item.key === activeNav ? " active" : "";
      return `<li class="app-shell-nav-item${activeClass}"><a data-testid="app-nav-${escapeHtml(
        item.key,
      )}" href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a></li>`;
    })
    .join("");

  return `<nav class="app-shell-nav"><div class="app-shell-brand">Bike EPOS</div><ul class="app-shell-nav-list">${links}</ul></nav>`;
};

export const wrapAuthedPage = (input: AppShellInput): string => {
  if (input.html.includes('data-app-shell="true"')) {
    return input.html;
  }

  const safeTitle = escapeHtml(input.title);
  const displayName = escapeHtml(
    (input.user.name && input.user.name.trim()) || input.user.username || input.user.id,
  );
  const safeRole = escapeHtml(input.user.role);

  const shellStart = `<div class="app-shell" data-app-shell="true">${renderNav(
    input.user.role,
    input.activeNav,
  )}<div class="app-shell-main"><header class="app-shell-topbar"><div class="app-shell-title">${safeTitle}</div><div class="app-shell-user"><span data-testid="app-shell-user">${displayName} (${safeRole})</span><button id="app-shell-logout" class="app-shell-logout" type="button" data-testid="app-shell-logout">Logout</button></div></header><main class="app-shell-content">`;

  const shellEnd = `</main></div></div>${appShellScript}`;

  let output = input.html;
  output = output.includes("</head>")
    ? output.replace("</head>", `${appShellStyles}</head>`)
    : `${appShellStyles}${output}`;

  output = output.replace(/<body([^>]*)>/i, `<body$1>${shellStart}`);
  output = output.replace("</body>", `${shellEnd}</body>`);

  return output;
};
