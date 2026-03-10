import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";

type WarrantyStatus = "OPEN" | "FOLLOW_UP" | "RETURNED" | "RESOLVED";

type WarrantyItem = {
  workshopJobId: string;
  rawStatus: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  bikeDescription: string | null;
  scheduledDate: string | null;
  sale: {
    id: string;
    totalPence: number;
  } | null;
  warrantyStatus: WarrantyStatus;
  latestWarrantyNote: string;
  latestWarrantyNoteAt: string;
  noteCount: number;
};

type WarrantyReportResponse = {
  summary: {
    trackedJobCount: number;
    openCount: number;
    followUpCount: number;
    returnedCount: number;
    resolvedCount: number;
  };
  items: WarrantyItem[];
};

type WorkshopSearchJob = {
  id: string;
  bikeDescription: string | null;
  status: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
};

type WorkshopDashboardResponse = {
  jobs: WorkshopSearchJob[];
};

const statusOptions: Array<{ value: WarrantyStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "OPEN", label: "Open" },
  { value: "FOLLOW_UP", label: "Follow Up" },
  { value: "RETURNED", label: "Returned" },
  { value: "RESOLVED", label: "Resolved" },
];

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const buildTaggedWarrantyNote = (status: WarrantyStatus, note: string) =>
  `[WARRANTY:${status}] ${note.trim()}`.trim();

export const WarrantyTrackingPage = () => {
  const { success, error } = useToasts();
  const [status, setStatus] = useState<WarrantyStatus | "">("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [report, setReport] = useState<WarrantyReportResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const [jobSearch, setJobSearch] = useState("");
  const debouncedJobSearch = useDebouncedValue(jobSearch, 250);
  const [jobResults, setJobResults] = useState<WorkshopSearchJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<WorkshopSearchJob | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<WarrantyStatus>("OPEN");
  const [trackingNote, setTrackingNote] = useState("");
  const [saving, setSaving] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ take: "100" });
      if (status) {
        params.set("status", status);
      }
      if (debouncedSearch.trim()) {
        params.set("search", debouncedSearch.trim());
      }
      const payload = await apiGet<WarrantyReportResponse>(`/api/reports/workshop/warranty?${params.toString()}`);
      setReport(payload);
    } catch (loadError) {
      setReport(null);
      error(loadError instanceof Error ? loadError.message : "Failed to load warranty tracking");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, debouncedSearch]);

  useEffect(() => {
    if (!debouncedJobSearch.trim()) {
      setJobResults([]);
      return;
    }

    let cancelled = false;

    const loadJobResults = async () => {
      try {
        const payload = await apiGet<WorkshopDashboardResponse>(
          `/api/workshop/dashboard?search=${encodeURIComponent(debouncedJobSearch.trim())}&includeCancelled=false&limit=10`,
        );
        if (!cancelled) {
          setJobResults(payload.jobs || []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setJobResults([]);
          error(loadError instanceof Error ? loadError.message : "Failed to search workshop jobs");
        }
      }
    };

    void loadJobResults();
    return () => {
      cancelled = true;
    };
  }, [debouncedJobSearch, error]);

  const grouped = useMemo(() => ({
    open: report?.items.filter((item) => item.warrantyStatus === "OPEN") ?? [],
    followUp: report?.items.filter((item) => item.warrantyStatus === "FOLLOW_UP") ?? [],
    returned: report?.items.filter((item) => item.warrantyStatus === "RETURNED") ?? [],
    resolved: report?.items.filter((item) => item.warrantyStatus === "RESOLVED") ?? [],
  }), [report]);

  const saveTrackingNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedJob) {
      error("Select a workshop job first.");
      return;
    }
    if (!trackingNote.trim()) {
      error("Tracking note is required.");
      return;
    }

    setSaving(true);
    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(selectedJob.id)}/notes`, {
        visibility: "INTERNAL",
        note: buildTaggedWarrantyNote(trackingStatus, trackingNote),
      });
      setTrackingNote("");
      setSelectedJob(null);
      setJobSearch("");
      setJobResults([]);
      success("Warranty tracking note added");
      await loadReport();
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save warranty tracking note");
    } finally {
      setSaving(false);
    }
  };

  const renderRows = (rows: WarrantyItem[], emptyText: string) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Job</th>
            <th>Customer</th>
            <th>Status</th>
            <th>Latest Tracking Note</th>
            <th>Linked Sale</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5}>{emptyText}</td>
            </tr>
          ) : rows.map((row) => (
            <tr key={row.workshopJobId}>
              <td>
                <div className="table-primary"><Link to={`/workshop/${row.workshopJobId}`}>{row.workshopJobId.slice(0, 8)}</Link></div>
                <div className="table-secondary">{row.bikeDescription || row.rawStatus}</div>
              </td>
              <td>
                <div>{row.customerId ? <Link to={`/customers/${row.customerId}`}>{row.customerName}</Link> : row.customerName}</div>
                <div className="table-secondary">{row.customerPhone || row.customerEmail || "-"}</div>
              </td>
              <td>
                <div><span className="status-badge">{row.warrantyStatus}</span></div>
                <div className="table-secondary">{new Date(row.latestWarrantyNoteAt).toLocaleString()}</div>
              </td>
              <td>{row.latestWarrantyNote || "-"}</td>
              <td>
                {row.sale ? (
                  <div>
                    <div className="table-primary"><Link to={`/pos?saleId=${encodeURIComponent(row.sale.id)}`}>Sale {row.sale.id.slice(0, 8)}</Link></div>
                    <div className="table-secondary">{formatMoney(row.sale.totalPence)}</div>
                  </div>
                ) : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Warranty Tracking</h1>
            <p className="muted-text">
              Internal tracking queue for warranty-related workshop follow-up. This uses tagged internal workshop notes rather than a separate RMA subsystem.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadReport()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="filter-row">
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value as WarrantyStatus | "")}>
              {statusOptions.map((option) => (
                <option key={option.label} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="grow">
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="customer, job, bike, tracking note"
            />
          </label>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Tracked Jobs</span>
            <strong className="metric-value">{report?.summary.trackedJobCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Latest tagged warranty entries</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Open</span>
            <strong className="metric-value">{report?.summary.openCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Active warranty follow-up</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Returned</span>
            <strong className="metric-value">{report?.summary.returnedCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Parts or items sent back</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Resolved</span>
            <strong className="metric-value">{report?.summary.resolvedCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Closed warranty items</span>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Log Warranty Tracking</h2>
        <form className="page-shell" onSubmit={saveTrackingNote}>
          <div className="filter-row">
            <label className="grow">
              Search workshop job
              <input
                value={jobSearch}
                onChange={(event) => setJobSearch(event.target.value)}
                placeholder="customer name, bike, note"
              />
            </label>
            <label>
              Tracking status
              <select value={trackingStatus} onChange={(event) => setTrackingStatus(event.target.value as WarrantyStatus)}>
                {statusOptions.filter((option) => option.value).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {jobResults.length === 0 ? (
                  <tr>
                    <td colSpan={3}>Search for a workshop job to tag.</td>
                  </tr>
                ) : jobResults.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <div className="table-primary">{job.id.slice(0, 8)}</div>
                      <div className="table-secondary">{job.bikeDescription || "-"}</div>
                    </td>
                    <td>{job.status}</td>
                    <td>
                      <button type="button" onClick={() => setSelectedJob(job)}>
                        {selectedJob?.id === job.id ? "Selected" : "Select"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label>
            Internal tracking note
            <textarea
              value={trackingNote}
              onChange={(event) => setTrackingNote(event.target.value)}
              rows={4}
              placeholder="Describe the warranty issue, supplier return, or next follow-up step"
            />
          </label>

          <div className="actions-inline">
            <span className="muted-text">
              Selected job: {selectedJob ? `${selectedJob.id.slice(0, 8)} ${selectedJob.bikeDescription || ""}` : "none"}
            </span>
            <button type="submit" className="primary" disabled={saving || !selectedJob}>
              {saving ? "Saving..." : "Add tracking note"}
            </button>
          </div>
        </form>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <h2>Open</h2>
          {renderRows(grouped.open, "No open warranty tracking items.")}
        </section>
        <section className="card">
          <h2>Follow Up</h2>
          {renderRows(grouped.followUp, "No warranty items are marked for follow-up.")}
        </section>
        <section className="card">
          <h2>Returned</h2>
          {renderRows(grouped.returned, "No warranty returns are currently tracked.")}
        </section>
        <section className="card">
          <h2>Resolved</h2>
          {renderRows(grouped.resolved, "No resolved warranty items yet.")}
        </section>
      </div>
    </div>
  );
};
