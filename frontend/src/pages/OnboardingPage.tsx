import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type UserListResponse = {
  users: Array<{
    id: string;
    role: "STAFF" | "MANAGER" | "ADMIN";
    isActive: boolean;
  }>;
};

type SupplierResponse = {
  suppliers: Array<{ id: string }>;
};

type VariantListResponse = {
  variants: Array<{
    id: string;
    barcode: string | null;
    retailPricePence: number;
    costPricePence: number | null;
  }>;
};

type InventorySearchResponse = {
  rows: Array<{
    variantId: string;
    onHand: number;
  }>;
};

type WorkshopDashboardResponse = {
  jobs: Array<{
    id: string;
    status: string;
    scheduledDate: string | null;
  }>;
};

type CashSessionListResponse = {
  sessions: Array<{
    id: string;
    status: "OPEN" | "CLOSED";
  }>;
};

type ChecklistRow = {
  key: string;
  title: string;
  status: "Ready" | "Needs Setup" | "Guidance";
  detail: string;
  path: string;
  action: string;
};

const formatDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export const OnboardingPage = () => {
  const { error } = useToasts();
  const [users, setUsers] = useState<UserListResponse["users"]>([]);
  const [suppliers, setSuppliers] = useState<SupplierResponse["suppliers"]>([]);
  const [variants, setVariants] = useState<VariantListResponse["variants"]>([]);
  const [inventoryRows, setInventoryRows] = useState<InventorySearchResponse["rows"]>([]);
  const [workshopJobs, setWorkshopJobs] = useState<WorkshopDashboardResponse["jobs"]>([]);
  const [sessions, setSessions] = useState<CashSessionListResponse["sessions"]>([]);
  const [loading, setLoading] = useState(false);

  const loadPage = async () => {
    setLoading(true);
    const today = new Date();
    const from = formatDateKey(shiftDays(today, -30));
    const to = formatDateKey(today);

    const [usersResult, supplierResult, variantResult, inventoryResult, workshopResult, tillResult] = await Promise.allSettled([
      apiGet<UserListResponse>("/api/admin/users"),
      apiGet<SupplierResponse>("/api/suppliers?query="),
      apiGet<VariantListResponse>("/api/variants?take=250&skip=0"),
      apiGet<InventorySearchResponse>("/api/inventory/on-hand/search?take=100&skip=0"),
      apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?includeCancelled=false&limit=100"),
      apiGet<CashSessionListResponse>(`/api/till/sessions?from=${from}&to=${to}`),
    ]);

    if (usersResult.status === "fulfilled") setUsers(usersResult.value.users || []); else { setUsers([]); error(usersResult.reason instanceof Error ? usersResult.reason.message : "Failed to load staff readiness"); }
    if (supplierResult.status === "fulfilled") setSuppliers(supplierResult.value.suppliers || []); else { setSuppliers([]); error(supplierResult.reason instanceof Error ? supplierResult.reason.message : "Failed to load supplier readiness"); }
    if (variantResult.status === "fulfilled") setVariants(variantResult.value.variants || []); else { setVariants([]); error(variantResult.reason instanceof Error ? variantResult.reason.message : "Failed to load product readiness"); }
    if (inventoryResult.status === "fulfilled") setInventoryRows(inventoryResult.value.rows || []); else { setInventoryRows([]); error(inventoryResult.reason instanceof Error ? inventoryResult.reason.message : "Failed to load inventory readiness"); }
    if (workshopResult.status === "fulfilled") setWorkshopJobs(workshopResult.value.jobs || []); else { setWorkshopJobs([]); error(workshopResult.reason instanceof Error ? workshopResult.reason.message : "Failed to load workshop readiness"); }
    if (tillResult.status === "fulfilled") setSessions(tillResult.value.sessions || []); else { setSessions([]); error(tillResult.reason instanceof Error ? tillResult.reason.message : "Failed to load till readiness"); }

    setLoading(false);
  };

  useEffect(() => {
    void loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checklist = useMemo<ChecklistRow[]>(() => {
    const activeUsers = users.filter((user) => user.isActive);
    const activeOperationalUsers = activeUsers.filter((user) => user.role !== "ADMIN");
    const readyVariants = variants.filter((variant) => variant.retailPricePence > 0 && variant.costPricePence !== null);
    const stockedRows = inventoryRows.filter((row) => row.onHand > 0);
    const workshopEvidence = workshopJobs.length;
    const openTillCount = sessions.filter((session) => session.status === "OPEN").length;

    return [
      {
        key: "users",
        title: "Staff / users",
        status: activeOperationalUsers.length > 0 ? "Ready" : "Needs Setup",
        detail: activeOperationalUsers.length > 0
          ? `${activeOperationalUsers.length} active operational users are available beyond admin accounts.`
          : "Create at least one active staff or manager account so day-to-day workflows can be exercised.",
        path: "/management/staff",
        action: "Open staff management",
      },
      {
        key: "suppliers",
        title: "Suppliers",
        status: suppliers.length > 0 ? "Ready" : "Needs Setup",
        detail: suppliers.length > 0
          ? `${suppliers.length} suppliers are present for purchasing and receiving workflows.`
          : "Add at least one supplier before relying on purchasing or receiving flows.",
        path: "/suppliers",
        action: "Open suppliers",
      },
      {
        key: "products",
        title: "Products & pricing",
        status: readyVariants.length > 0 ? "Ready" : "Needs Setup",
        detail: readyVariants.length > 0
          ? `${readyVariants.length} variants already have visible sell-ready cost and retail pricing.`
          : "Complete enough product data so items have cost and retail price before relying on POS or purchasing decisions.",
        path: "/management/product-data",
        action: "Open product data queue",
      },
      {
        key: "inventory",
        title: "Inventory readiness",
        status: stockedRows.length > 0 ? "Ready" : "Needs Setup",
        detail: stockedRows.length > 0
          ? `${stockedRows.length} inventory rows currently show positive on-hand stock.`
          : "Load opening stock or complete stock adjustments so the shop has usable inventory visibility.",
        path: "/inventory",
        action: "Open inventory",
      },
      {
        key: "workshop",
        title: "Workshop readiness",
        status: workshopEvidence > 0 ? "Ready" : "Guidance",
        detail: workshopEvidence > 0
          ? `${workshopEvidence} workshop jobs or bookings are already visible.`
          : "No workshop jobs are visible yet. The workflow is available; use check-in or bookings when the workshop starts operating.",
        path: "/workshop/check-in",
        action: "Open workshop check-in",
      },
      {
        key: "till",
        title: "Till / cash readiness",
        status: openTillCount > 0 || sessions.length > 0 ? "Ready" : "Needs Setup",
        detail: openTillCount > 0
          ? `${openTillCount} till session(s) are currently open.`
          : sessions.length > 0
            ? "Till history exists, but no till is currently open for today."
            : "No till sessions exist yet. Open a till before using cash workflows live.",
        path: "/management/cash",
        action: "Open cash oversight",
      },
    ];
  }, [inventoryRows, sessions, suppliers.length, users, variants, workshopJobs.length]);

  const readyCount = checklist.filter((row) => row.status === "Ready").length;

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>First Run / Onboarding</h1>
            <p className="muted-text">
              Admin setup hub for getting CorePOS operational. This first version is a structured checklist and guidance page built from the current app state, not a provisioning wizard.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management/settings">System settings</Link>
            <button type="button" onClick={() => void loadPage()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Checklist Steps</span>
            <strong className="metric-value">{checklist.length}</strong>
            <span className="dashboard-metric-detail">Core setup areas for a first operational rollout</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Ready</span>
            <strong className="metric-value">{readyCount}</strong>
            <span className="dashboard-metric-detail">Areas that already show usable operational evidence</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Needs Setup</span>
            <strong className="metric-value">{checklist.filter((row) => row.status === "Needs Setup").length}</strong>
            <span className="dashboard-metric-detail">Areas that still need setup before confident use</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Guidance Only</span>
            <strong className="metric-value">{checklist.filter((row) => row.status === "Guidance").length}</strong>
            <span className="dashboard-metric-detail">Areas where the workflow exists but setup progress is not fully derivable</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <h2>Getting Started Checklist</h2>
          <Link to="/management/docs">Open documentation hub</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Area</th>
                <th>Status</th>
                <th>What this means</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {checklist.map((row) => (
                <tr key={row.key}>
                  <td>{row.title}</td>
                  <td>
                    <span className={row.status === "Ready" ? "status-badge status-complete" : row.status === "Needs Setup" ? "status-badge status-warning" : "status-badge"}>
                      {row.status}
                    </span>
                  </td>
                  <td>{row.detail}</td>
                  <td><Link to={row.path}>{row.action}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Suggested First-Day Sequence</h2>
            <Link to="/home">Role home</Link>
          </div>
          <ol>
            <li>Create operational users and confirm the right roles in staff management.</li>
            <li>Add suppliers, then review product data so cost/price/barcode coverage is usable.</li>
            <li>Load opening stock or complete inventory adjustments so stock visibility is trustworthy.</li>
            <li>Open a till before running live cash workflows.</li>
            <li>Use workshop check-in or bookings when the workshop starts taking jobs.</li>
          </ol>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Useful Admin Links</h2>
            <Link to="/management/admin-review">Admin review</Link>
          </div>
          <ul>
            <li><Link to="/management/staff">Staff management</Link></li>
            <li><Link to="/management/product-data">Product data queue</Link></li>
            <li><Link to="/management/backups">Backup toolkit</Link></li>
            <li><Link to="/management/docs">Documentation hub</Link></li>
          </ul>
        </section>
      </div>
    </div>
  );
};
