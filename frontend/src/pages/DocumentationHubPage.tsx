import { Link } from "react-router-dom";

type DocSection = {
  title: string;
  summary: string;
  links: Array<{ label: string; path: string }>;
  notes: string[];
};

const sections: DocSection[] = [
  {
    title: "Retail / POS Operations",
    summary: "Core till workflows, receipts, refunds, cash oversight, and daily close visibility.",
    links: [
      { label: "POS", path: "/pos" },
      { label: "Trade Close", path: "/management/trade-close" },
      { label: "Cash Oversight", path: "/management/cash" },
      { label: "Refund Oversight", path: "/management/refunds" },
    ],
    notes: [
      "Use POS for live sales and receipts.",
      "Use Trade Close and Cash Oversight to review the day’s financial position.",
    ],
  },
  {
    title: "Workshop Operations",
    summary: "Check-in, bookings, board planning, approvals, parts allocation, collection, and print outputs.",
    links: [
      { label: "Workshop Board", path: "/workshop" },
      { label: "Workshop Check-In", path: "/workshop/check-in" },
      { label: "Bookings", path: "/workshop/bookings" },
      { label: "Collection", path: "/workshop/collection" },
      { label: "Workshop Print", path: "/workshop/print" },
    ],
    notes: [
      "Use Bookings and Check-In for intake; use the board and ageing/capacity views for ongoing control.",
      "Use the print centre to reach existing job-card and receipt print outputs.",
    ],
  },
  {
    title: "Purchasing / Receiving",
    summary: "Suppliers, purchase orders, receiving workspace, and action queues for overdue or partial deliveries.",
    links: [
      { label: "Suppliers", path: "/suppliers" },
      { label: "Purchasing", path: "/purchasing" },
      { label: "Receiving Workspace", path: "/purchasing/receiving" },
      { label: "PO Action Centre", path: "/management/purchasing" },
    ],
    notes: [
      "Receiving actions still happen in PO detail; the receiving workspace is the queue into those workflows.",
      "Use supplier returns and supplier performance views for follow-up rather than a separate RMA system.",
    ],
  },
  {
    title: "Reporting / Exports",
    summary: "Management reporting, exports, integrity views, and operational health surfaces.",
    links: [
      { label: "Management Dashboard", path: "/management" },
      { label: "Export Hub", path: "/management/exports" },
      { label: "Data Integrity", path: "/management/integrity" },
      { label: "Ops Health", path: "/management/health" },
    ],
    notes: [
      "Most management pages are composed from existing operational endpoints rather than separate warehouse-style reporting services.",
      "Use the export hub for supported CSV/report downloads; use integrity and health for operational exceptions.",
    ],
  },
  {
    title: "Backup / Reset / Recovery",
    summary: "Operational guidance for exports, local resets, migrations, and test-env execution on this branch.",
    links: [
      { label: "Backup Toolkit", path: "/management/backups" },
      { label: "System Settings", path: "/management/settings" },
      { label: "Admin Review", path: "/management/admin-review" },
    ],
    notes: [
      "This branch does not add an in-app backup engine.",
      "Use the backup toolkit for supported exports and repo command guidance such as reset, migrate, seed, and test-env execution.",
    ],
  },
  {
    title: "Admin / Governance",
    summary: "Roles, staff management, admin review, onboarding, and control points for secure operation.",
    links: [
      { label: "Staff Management", path: "/management/staff" },
      { label: "Admin Review", path: "/management/admin-review" },
      { label: "Onboarding", path: "/management/onboarding" },
      { label: "System Settings", path: "/management/settings" },
    ],
    notes: [
      "Use staff management for the actual persisted user/role changes.",
      "Use admin review and system settings as visibility/control surfaces rather than replacing the auth model.",
    ],
  },
];

export const DocumentationHubPage = () => {
  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Operations Documentation Hub</h1>
            <p className="muted-text">
              Manager/admin help centre for the operational guidance already represented across the app. This is a curated in-app hub, not a documentation CMS.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management">Back to management</Link>
            <Link to="/management/onboarding">First run</Link>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        {sections.map((section) => (
          <section key={section.title} className="card">
            <div className="card-header-row">
              <h2>{section.title}</h2>
              {section.links[0] ? <Link to={section.links[0].path}>Open section</Link> : null}
            </div>
            <p className="muted-text">{section.summary}</p>
            <div className="actions-inline">
              {section.links.map((link) => (
                <Link key={link.path} to={link.path}>{link.label}</Link>
              ))}
            </div>
            <ul>
              {section.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
};
