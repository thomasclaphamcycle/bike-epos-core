export type NavigationRole = "STAFF" | "MANAGER" | "ADMIN";

type NavigationMatchConfig = {
  matchExact?: string[];
  matchPrefixes?: string[];
};

export type NavigationLinkItem = NavigationMatchConfig & {
  kind: "link";
  label: string;
  to: string;
  minimumRole: NavigationRole;
};

export type NavigationLabelItem = {
  kind: "label";
  label: string;
  minimumRole: NavigationRole;
};

export type NavigationChildItem = NavigationLinkItem | NavigationLabelItem;

export type NavigationSection = NavigationMatchConfig & {
  id: string;
  label: string;
  to: string;
  minimumRole: NavigationRole;
  items?: NavigationChildItem[];
  defaultExpanded?: boolean;
};

export const roleRank: Record<NavigationRole, number> = {
  STAFF: 1,
  MANAGER: 2,
  ADMIN: 3,
};

export const canAccessNavigationRole = (
  currentRole: NavigationRole | undefined,
  minimumRole: NavigationRole,
) => Boolean(currentRole) && roleRank[currentRole] >= roleRank[minimumRole];

export const matchesNavigationPath = (
  currentPath: string,
  item: NavigationMatchConfig & { to?: string },
) => {
  const exact = item.matchExact ?? [];
  const prefixes = item.matchPrefixes ?? [];

  if (item.to && currentPath === item.to) {
    return true;
  }

  if (exact.includes(currentPath)) {
    return true;
  }

  return prefixes.some((prefix) => currentPath.startsWith(prefix));
};

export const navigationSections: NavigationSection[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    to: "/dashboard",
    minimumRole: "STAFF",
    matchExact: ["/dashboard", "/home", "/"],
  },
  {
    id: "pos",
    label: "POS",
    to: "/pos",
    minimumRole: "STAFF",
    defaultExpanded: true,
    matchPrefixes: ["/pos"],
    matchExact: ["/management/cash", "/sales-history/receipt-view"],
    items: [
      {
        kind: "link",
        label: "Sale",
        to: "/pos",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Receipts",
        to: "/sales-history/receipt-view",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Cash Management",
        to: "/management/cash",
        minimumRole: "MANAGER",
      },
    ],
  },
  {
    id: "sales-history",
    label: "Sales History",
    to: "/sales-history/transactions",
    minimumRole: "STAFF",
    matchPrefixes: ["/sales-history"],
    matchExact: ["/management/refunds"],
    items: [
      {
        kind: "link",
        label: "Transaction List",
        to: "/sales-history/transactions",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Receipt View",
        to: "/sales-history/receipt-view",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Refund",
        to: "/sales-history/refund",
        minimumRole: "MANAGER",
        matchExact: ["/management/refunds"],
      },
      {
        kind: "link",
        label: "Exchange",
        to: "/sales-history/exchange",
        minimumRole: "STAFF",
      },
    ],
  },
  {
    id: "workshop",
    label: "Workshop",
    to: "/workshop",
    minimumRole: "STAFF",
    matchPrefixes: ["/workshop"],
    matchExact: ["/tasks", "/management/workshop"],
    items: [
      {
        kind: "link",
        label: "Job Board",
        to: "/workshop",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "New Job",
        to: "/workshop/new",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Technician View",
        to: "/workshop/technician",
        minimumRole: "STAFF",
        matchExact: ["/tasks"],
      },
      {
        kind: "link",
        label: "Workshop Analytics",
        to: "/workshop/analytics",
        minimumRole: "MANAGER",
        matchExact: ["/management/workshop"],
      },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    to: "/inventory",
    minimumRole: "STAFF",
    matchPrefixes: ["/inventory"],
    matchExact: ["/management/transfers"],
    items: [
      {
        kind: "label",
        label: "Products",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Product List",
        to: "/inventory/products",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Categories",
        to: "/inventory/products/categories",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Brands",
        to: "/inventory/products/brands",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Attributes",
        to: "/inventory/products/attributes",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Stock Levels",
        to: "/inventory",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Stocktake",
        to: "/inventory/stocktakes",
        minimumRole: "MANAGER",
      },
      {
        kind: "link",
        label: "Transfers",
        to: "/inventory/transfers",
        minimumRole: "MANAGER",
        matchExact: ["/management/transfers"],
      },
      {
        kind: "link",
        label: "Adjustments",
        to: "/inventory/adjustments",
        minimumRole: "MANAGER",
      },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    to: "/customers",
    minimumRole: "STAFF",
    matchPrefixes: ["/customers"],
    items: [
      {
        kind: "link",
        label: "Customer List",
        to: "/customers",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Customer Bikes",
        to: "/customers/bikes",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Service History",
        to: "/customers/service-history",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Loyalty",
        to: "/customers/loyalty",
        minimumRole: "STAFF",
      },
    ],
  },
  {
    id: "purchasing",
    label: "Purchasing",
    to: "/purchasing",
    minimumRole: "STAFF",
    matchPrefixes: ["/purchasing", "/suppliers"],
    items: [
      {
        kind: "link",
        label: "Suppliers",
        to: "/suppliers",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Purchase Orders",
        to: "/purchasing",
        minimumRole: "STAFF",
      },
      {
        kind: "link",
        label: "Receive Deliveries",
        to: "/purchasing/receive-deliveries",
        minimumRole: "STAFF",
        matchExact: ["/purchasing/receiving"],
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    to: "/reports/sales",
    minimumRole: "MANAGER",
    matchPrefixes: ["/reports"],
    matchExact: [
      "/management/sales",
      "/management/inventory",
      "/management/workshop",
      "/management/staff-performance",
    ],
    items: [
      {
        kind: "link",
        label: "Sales Reports",
        to: "/reports/sales",
        minimumRole: "MANAGER",
        matchExact: ["/management/sales"],
      },
      {
        kind: "link",
        label: "Inventory Reports",
        to: "/reports/inventory",
        minimumRole: "MANAGER",
        matchExact: ["/management/inventory"],
      },
      {
        kind: "link",
        label: "Workshop Reports",
        to: "/reports/workshop",
        minimumRole: "MANAGER",
        matchExact: ["/management/workshop"],
      },
      {
        kind: "link",
        label: "Staff Performance",
        to: "/reports/staff-performance",
        minimumRole: "MANAGER",
        matchExact: ["/management/staff-performance"],
      },
    ],
  },
  {
    id: "rental",
    label: "Rental",
    to: "/rental/calendar",
    minimumRole: "MANAGER",
    matchPrefixes: ["/rental"],
    matchExact: ["/management/hire"],
    items: [
      {
        kind: "link",
        label: "Rental Calendar",
        to: "/rental/calendar",
        minimumRole: "MANAGER",
        matchExact: ["/management/hire"],
      },
      {
        kind: "link",
        label: "New Rental",
        to: "/rental/new",
        minimumRole: "MANAGER",
      },
      {
        kind: "link",
        label: "Active Rentals",
        to: "/rental/active",
        minimumRole: "MANAGER",
      },
      {
        kind: "link",
        label: "Returns",
        to: "/rental/returns",
        minimumRole: "MANAGER",
      },
      {
        kind: "link",
        label: "Rental History",
        to: "/rental/history",
        minimumRole: "MANAGER",
      },
    ],
  },
  {
    id: "online-store",
    label: "Online Store",
    to: "/online-store/orders",
    minimumRole: "MANAGER",
    matchPrefixes: ["/online-store"],
    items: [
      {
        kind: "link",
        label: "Orders",
        to: "/online-store/orders",
        minimumRole: "MANAGER",
      },
      {
        kind: "link",
        label: "Products",
        to: "/online-store/products",
        minimumRole: "MANAGER",
      },
      {
        kind: "link",
        label: "Click & Collect",
        to: "/online-store/click-collect",
        minimumRole: "MANAGER",
      },
      {
        kind: "link",
        label: "Website Builder",
        to: "/online-store/website-builder",
        minimumRole: "MANAGER",
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    to: "/settings/store-info",
    minimumRole: "ADMIN",
    matchPrefixes: ["/settings"],
    matchExact: [
      "/management/settings",
      "/management/staff",
      "/management/admin-review",
      "/management/health",
    ],
    items: [
      {
        kind: "link",
        label: "Store Info",
        to: "/settings/store-info",
        minimumRole: "ADMIN",
        matchExact: ["/management/settings"],
      },
      {
        kind: "label",
        label: "Staff & Roles",
        minimumRole: "ADMIN",
      },
      {
        kind: "link",
        label: "Staff List",
        to: "/settings/staff-list",
        minimumRole: "ADMIN",
        matchExact: ["/management/staff"],
      },
      {
        kind: "link",
        label: "Roles & Permissions",
        to: "/settings/roles-permissions",
        minimumRole: "ADMIN",
        matchExact: ["/management/admin-review"],
      },
      {
        kind: "link",
        label: "Staff Rota",
        to: "/settings/staff-rota",
        minimumRole: "ADMIN",
      },
      {
        kind: "link",
        label: "POS Settings",
        to: "/settings/pos",
        minimumRole: "ADMIN",
      },
      {
        kind: "link",
        label: "Workshop Settings",
        to: "/settings/workshop",
        minimumRole: "ADMIN",
      },
      {
        kind: "link",
        label: "Inventory Settings",
        to: "/settings/inventory",
        minimumRole: "ADMIN",
      },
      {
        kind: "link",
        label: "Payments",
        to: "/settings/payments",
        minimumRole: "ADMIN",
      },
      {
        kind: "link",
        label: "Integrations",
        to: "/settings/integrations",
        minimumRole: "ADMIN",
      },
      {
        kind: "link",
        label: "Receipts",
        to: "/settings/receipts",
        minimumRole: "ADMIN",
      },
      {
        kind: "link",
        label: "System / Diagnostics",
        to: "/settings/system-diagnostics",
        minimumRole: "ADMIN",
        matchExact: ["/management/health"],
      },
    ],
  },
];
