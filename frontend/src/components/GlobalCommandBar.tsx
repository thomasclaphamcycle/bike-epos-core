import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

type CustomerResponse = {
  customers: CustomerRow[];
};

type WorkshopJob = {
  id: string;
  status: string;
  bikeDescription: string | null;
  customer: {
    firstName: string;
    lastName: string;
  } | null;
};

type WorkshopResponse = {
  jobs: WorkshopJob[];
};

type ProductRow = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  pricePence: number;
  onHandQty: number;
};

type SupplierRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

type SupplierResponse = {
  suppliers: SupplierRow[];
};

type PurchaseOrder = {
  id: string;
  status: string;
  supplier: {
    name: string;
  };
};

type PurchaseOrderResponse = {
  purchaseOrders: PurchaseOrder[];
};

type CommandResult = {
  key: string;
  group: string;
  title: string;
  subtitle: string;
  path: string;
};

const isManagerPlus = (role: string | undefined) => role === "MANAGER" || role === "ADMIN";

const staticCommands = (role: string | undefined): CommandResult[] => {
  const base: CommandResult[] = [
    { key: "cmd-pos", group: "Shortcut", title: "Open POS", subtitle: "Go to the till", path: "/pos" },
    { key: "cmd-checkin", group: "Shortcut", title: "New check-in", subtitle: "Workshop intake form", path: "/workshop/check-in" },
    { key: "cmd-tasks", group: "Shortcut", title: "Open tasks", subtitle: "Internal follow-up queue", path: "/tasks" },
    { key: "cmd-bookings", group: "Shortcut", title: "Workshop bookings", subtitle: "Upcoming workshop intake", path: "/workshop/bookings" },
    { key: "cmd-receiving", group: "Shortcut", title: "Supplier receiving", subtitle: "Goods-in workspace", path: "/purchasing/receiving" },
    { key: "cmd-inventory-locations", group: "Shortcut", title: "Inventory by location", subtitle: "Stock split by location", path: "/inventory/locations" },
    { key: "cmd-dashboard", group: "Shortcut", title: "Staff dashboard", subtitle: "Operational overview", path: "/dashboard" },
  ];

  if (isManagerPlus(role)) {
    base.push(
      { key: "cmd-management", group: "Shortcut", title: "Management dashboard", subtitle: "Manager home", path: "/management" },
      { key: "cmd-trade-close", group: "Shortcut", title: "Daily trade close", subtitle: "Daily financial and operational close pack", path: "/management/trade-close" },
      { key: "cmd-liabilities", group: "Shortcut", title: "Liabilities review", subtitle: "Deposits, balances, and unpaid workshop work", path: "/management/liabilities" },
      { key: "cmd-health", group: "Shortcut", title: "Ops health", subtitle: "Operational readiness view", path: "/management/health" },
      { key: "cmd-integrity", group: "Shortcut", title: "Data integrity", subtitle: "Operational data problems and investigation queues", path: "/management/integrity" },
      { key: "cmd-alerts", group: "Shortcut", title: "Alerts centre", subtitle: "Operational alerts", path: "/management/alerts" },
      { key: "cmd-actions", group: "Shortcut", title: "Action centre", subtitle: "Grouped manager action queue", path: "/management/actions" },
      { key: "cmd-investigations", group: "Shortcut", title: "Stock investigations", subtitle: "Inventory anomaly review queue", path: "/management/investigations" },
      { key: "cmd-exceptions", group: "Shortcut", title: "Operations exceptions", subtitle: "Single queue of cross-functional issues", path: "/management/exceptions" },
      { key: "cmd-product-data", group: "Shortcut", title: "Product data queue", subtitle: "Data cleanup and product CSV import", path: "/management/product-data" },
      { key: "cmd-supplier-catalogue", group: "Shortcut", title: "Supplier catalogue", subtitle: "Supplier intake and product link management", path: "/management/catalogue" },
      { key: "cmd-pricing", group: "Shortcut", title: "Pricing review", subtitle: "Margin and pricing exceptions", path: "/management/pricing" },
      { key: "cmd-supplier-returns", group: "Shortcut", title: "Supplier returns", subtitle: "Warranty and receiving send-backs", path: "/management/supplier-returns" },
      { key: "cmd-purchasing", group: "Shortcut", title: "PO action centre", subtitle: "Open purchase order priorities", path: "/management/purchasing" },
      { key: "cmd-staff-performance", group: "Shortcut", title: "Staff performance", subtitle: "Workshop throughput and visible sales by staff", path: "/management/staff-performance" },
      { key: "cmd-transfers", group: "Shortcut", title: "Transfer queue", subtitle: "Location imbalance and replenishment", path: "/management/transfers" },
      { key: "cmd-ageing", group: "Shortcut", title: "Workshop ageing", subtitle: "Open-job SLA attention", path: "/management/workshop-ageing" },
      { key: "cmd-docs", group: "Shortcut", title: "Documentation hub", subtitle: "Operational guidance and help centre", path: "/management/docs" },
    );
  }

  if (role === "ADMIN") {
    base.push(
      { key: "cmd-admin-review", group: "Shortcut", title: "Admin review", subtitle: "Roles and admin activity", path: "/management/admin-review" },
      { key: "cmd-onboarding", group: "Shortcut", title: "First run onboarding", subtitle: "Operational setup checklist for new admins", path: "/management/onboarding" },
      { key: "cmd-backups", group: "Shortcut", title: "Backup toolkit", subtitle: "Exports and recovery guidance", path: "/management/backups" },
      { key: "cmd-settings", group: "Shortcut", title: "System settings", subtitle: "Current defaults and admin control points", path: "/management/settings" },
    );
  }

  return base;
};

const customerName = (customer: WorkshopJob["customer"]) =>
  customer ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "-" : "-";

export const GlobalCommandBar = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<CommandResult[]>([]);
  const [jobs, setJobs] = useState<CommandResult[]>([]);
  const [products, setProducts] = useState<CommandResult[]>([]);
  const [suppliers, setSuppliers] = useState<CommandResult[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<CommandResult[]>([]);
  const debouncedQuery = useDebouncedValue(query, 200);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      const needle = debouncedQuery.trim();
      if (!needle) {
        if (!cancelled) {
          setCustomers([]);
          setJobs([]);
          setProducts([]);
          setSuppliers([]);
          setPurchaseOrders([]);
        }
        return;
      }

      const manager = isManagerPlus(user?.role);
      const [customerResult, workshopResult, productResult, supplierResult, poResult] = await Promise.allSettled([
        apiGet<CustomerResponse>(`/api/customers?query=${encodeURIComponent(needle)}&take=6`),
        apiGet<WorkshopResponse>(`/api/workshop/dashboard?search=${encodeURIComponent(needle)}&includeCancelled=false&limit=6`),
        apiGet<ProductRow[]>(`/api/products/search?q=${encodeURIComponent(needle)}`),
        apiGet<SupplierResponse>(`/api/suppliers?query=${encodeURIComponent(needle)}`),
        manager ? apiGet<PurchaseOrderResponse>("/api/purchase-orders?take=50&skip=0") : Promise.resolve({ purchaseOrders: [] }),
      ]);

      if (!cancelled) {
        setCustomers(customerResult.status === "fulfilled"
          ? (customerResult.value.customers || []).slice(0, 6).map((row) => ({
              key: `customer-${row.id}`,
              group: "Customers",
              title: row.name,
              subtitle: row.email || row.phone || "Customer",
              path: `/customers/${row.id}`,
            }))
          : []);

        setJobs(workshopResult.status === "fulfilled"
          ? (workshopResult.value.jobs || []).slice(0, 6).map((row) => ({
              key: `job-${row.id}`,
              group: "Workshop",
              title: `Job ${row.id.slice(0, 8)}`,
              subtitle: `${row.status} | ${customerName(row.customer)}${row.bikeDescription ? ` | ${row.bikeDescription}` : ""}`,
              path: `/workshop/${row.id}`,
            }))
          : []);

        setProducts(productResult.status === "fulfilled"
          ? productResult.value.slice(0, 6).map((row) => ({
              key: `product-${row.id}`,
              group: "Products",
              title: row.name,
              subtitle: `${row.sku} | on hand ${row.onHandQty}`,
              path: `/inventory?q=${encodeURIComponent(row.sku || row.barcode || row.name)}`,
            }))
          : []);

        setSuppliers(supplierResult.status === "fulfilled"
          ? (supplierResult.value.suppliers || []).slice(0, 6).map((row) => ({
              key: `supplier-${row.id}`,
              group: "Suppliers",
              title: row.name,
              subtitle: row.email || row.phone || "Supplier",
              path: "/suppliers",
            }))
          : []);

        setPurchaseOrders(poResult.status === "fulfilled"
          ? (poResult.value.purchaseOrders || [])
              .filter((row) => [row.id, row.status, row.supplier.name].join(" ").toLowerCase().includes(needle.toLowerCase()))
              .slice(0, 6)
              .map((row) => ({
                key: `po-${row.id}`,
                group: "Purchase Orders",
                title: `PO ${row.id.slice(0, 8)}`,
                subtitle: `${row.supplier.name} | ${row.status}`,
                path: `/purchasing/${row.id}`,
              }))
          : []);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, open, user?.role]);

  const staticItems = useMemo(() => staticCommands(user?.role), [user?.role]);

  const results = useMemo(() => {
    const dynamic = [...customers, ...jobs, ...products, ...suppliers, ...purchaseOrders];
    if (!debouncedQuery.trim()) {
      return staticItems;
    }

    const needle = debouncedQuery.trim().toLowerCase();
    const shortcutMatches = staticItems.filter((item) =>
      `${item.title} ${item.subtitle}`.toLowerCase().includes(needle),
    );
    return [...shortcutMatches, ...dynamic];
  }, [customers, debouncedQuery, jobs, products, purchaseOrders, staticItems, suppliers]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandResult[]>();
    for (const result of results) {
      const current = map.get(result.group) ?? [];
      current.push(result);
      map.set(result.group, current);
    }
    return Array.from(map.entries());
  }, [results]);

  const go = (path: string) => {
    setOpen(false);
    setQuery("");
    navigate(path);
  };

  return (
    <>
      <button type="button" className="command-trigger" onClick={() => setOpen(true)}>
        Search or Jump
        <span className="command-hint">Ctrl/Cmd+K</span>
      </button>

      {open ? (
        <div
          className="command-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false);
            }
          }}
        >
          <div className="command-shell">
            <div className="card-header-row">
              <div>
                <h2>Search or Jump</h2>
                <p className="muted-text">Find records fast or jump straight into the most-used areas of the system.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)}>Close</button>
            </div>

            <input
              className="command-input"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search customers, jobs, products, suppliers, purchase orders, and shortcuts"
            />

            <div className="command-results">
              {grouped.length === 0 ? (
                <div className="restricted-panel info-panel">No results for this search.</div>
              ) : grouped.map(([group, items]) => (
                <section key={group} className="command-group">
                  <h3>{group}</h3>
                  <div className="command-list">
                    {items.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className="command-item"
                        onClick={() => go(item.path)}
                      >
                        <span className="command-title">{item.title}</span>
                        <span className="command-subtitle">{item.subtitle}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
