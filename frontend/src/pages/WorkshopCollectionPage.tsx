import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useOpenPosWithContext, type SaleContext } from "../features/pos/posContext";

type CollectionJob = {
  id: string;
  status: string;
  finalizedBasketId: string | null;
  scheduledDate: string | null;
  bikeDescription: string | null;
  depositRequiredPence: number;
  depositStatus: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  } | null;
  sale: {
    id: string;
    totalPence: number;
    createdAt: string;
  } | null;
  noteCount?: number;
};

type DashboardResponse = {
  jobs: CollectionJob[];
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const customerName = (job: CollectionJob) =>
  job.customer ? [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" ") || "-" : "-";

export const WorkshopCollectionPage = () => {
  const openPosWithContext = useOpenPosWithContext();
  const { success, error } = useToasts();
  const [jobs, setJobs] = useState<CollectionJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [handoffId, setHandoffId] = useState<string | null>(null);

  const loadReadyJobs = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<DashboardResponse>("/api/workshop/dashboard?status=READY_FOR_COLLECTION&includeCancelled=false&limit=100");
      setJobs(payload.jobs || []);
    } catch (loadError) {
      setJobs([]);
      error(loadError instanceof Error ? loadError.message : "Failed to load collection queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReadyJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => ({
    readyCount: jobs.length,
    withSaleCount: jobs.filter((job) => Boolean(job.sale)).length,
    handoffReadyCount: jobs.filter((job) => Boolean(job.sale || job.finalizedBasketId)).length,
    needsHandoffCount: jobs.filter((job) => !job.sale && !job.finalizedBasketId).length,
    depositPaidCount: jobs.filter((job) => job.depositStatus === "PAID" || job.depositStatus === "NOT_REQUIRED").length,
  }), [jobs]);

  const toSaleContext = (job: CollectionJob): SaleContext => ({
    type: "WORKSHOP",
    jobId: job.id,
    customerName: customerName(job),
    bikeLabel: job.bikeDescription ?? undefined,
    depositPaidPence: job.depositStatus === "PAID" ? job.depositRequiredPence : 0,
  });

  const openCollectionHandoff = async (job: CollectionJob) => {
    if (job.sale) {
      openPosWithContext(toSaleContext(job), [], {
        saleId: job.sale.id,
        customerId: job.customer?.id ?? null,
      });
      return;
    }

    if (job.finalizedBasketId) {
      openPosWithContext(toSaleContext(job), [], {
        basketId: job.finalizedBasketId,
        customerId: job.customer?.id ?? null,
      });
      return;
    }

    setHandoffId(job.id);
    try {
      const result = await apiPost<{ basket: { id: string } }>(
        `/api/workshop/jobs/${encodeURIComponent(job.id)}/finalize`,
        {},
      );
      success("Workshop handed off to POS");
      openPosWithContext(toSaleContext(job), [], {
        basketId: result.basket.id,
        customerId: job.customer?.id ?? null,
      });
    } catch (handoffError) {
      error(handoffError instanceof Error ? handoffError.message : "Failed to open POS handoff");
    } finally {
      setHandoffId(null);
    }
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Collection</h1>
            <p className="muted-text">
              Move ready jobs into POS, confirm the handoff, and finish collection through checkout.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/workshop">Back to workshop</Link>
            <button type="button" onClick={() => void loadReadyJobs()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Ready For Collection</span>
            <strong className="metric-value">{summary.readyCount}</strong>
            <span className="dashboard-metric-detail">Jobs currently in the ready-for-collection state</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Linked Sale Visible</span>
            <strong className="metric-value">{summary.withSaleCount}</strong>
            <span className="dashboard-metric-detail">Ready jobs already linked to a sale record</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">POS Handoff Ready</span>
            <strong className="metric-value">{summary.handoffReadyCount}</strong>
            <span className="dashboard-metric-detail">Sale or POS basket already available</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Needs POS Handoff</span>
            <strong className="metric-value">{summary.needsHandoffCount}</strong>
            <span className="dashboard-metric-detail">No linked sale or POS basket yet</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Deposit OK</span>
            <strong className="metric-value">{summary.depositPaidCount}</strong>
            <span className="dashboard-metric-detail">Deposit paid or not required</span>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Ready Queue</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Bike</th>
                <th>Promised</th>
                <th>Deposit</th>
                <th>Collection Readiness</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    Nothing is waiting for collection right now. Mark a job ready on the workshop board to bring it
                    into this queue.
                  </td>
                </tr>
              ) : jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <div className="table-primary">{customerName(job)}</div>
                    <div className="table-secondary">{job.customer?.phone || job.customer?.email || "-"}</div>
                  </td>
                  <td>
                    <div className="table-primary">{job.bikeDescription || "-"}</div>
                    <div className="table-secondary">
                      {job.noteCount && job.noteCount > 0
                        ? `${job.noteCount} job note${job.noteCount === 1 ? "" : "s"}`
                        : "No job notes"}
                    </div>
                  </td>
                  <td>{job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString() : "-"}</td>
                  <td>{job.depositStatus}</td>
                  <td>
                    {job.sale ? (
                      <div>
                        <div className="table-primary">Sale {job.sale.id.slice(0, 8)}</div>
                        <div className="table-secondary">{formatMoney(job.sale.totalPence)}</div>
                      </div>
                    ) : job.finalizedBasketId ? (
                      <div>
                        <div className="table-primary">POS basket ready</div>
                        <div className="table-secondary">Basket {job.finalizedBasketId.slice(0, 8)}</div>
                      </div>
                    ) : (
                      <span className="parts-short">Needs POS handoff</span>
                    )}
                  </td>
                  <td>
                    <div className="actions-inline">
                      <Link to={`/workshop/${job.id}`}>Open job</Link>
                      <button
                        type="button"
                        onClick={() => void openCollectionHandoff(job)}
                        disabled={handoffId === job.id}
                      >
                        {handoffId === job.id
                          ? "Opening..."
                          : job.sale
                            ? "Open sale"
                            : job.finalizedBasketId
                              ? "Open POS handoff"
                              : "Send to POS"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
          Collection finishes in POS checkout. Ready jobs without a linked sale stay here until staff open or create
          the POS handoff.
        </div>
      </section>
    </div>
  );
};
