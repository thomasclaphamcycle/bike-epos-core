import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { toBackendUrl } from "../utils/backendUrl";

type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

type TimelineItem = {
  id: string;
  type: "CUSTOMER_CREATED" | "SALE_COMPLETED" | "WORKSHOP_CREATED" | "WORKSHOP_COMPLETED" | "WORKSHOP_NOTE" | "CREDIT_ENTRY";
  occurredAt: string;
  title: string;
  summary: string;
  entityType: "CUSTOMER" | "SALE" | "WORKSHOP_JOB" | "CREDIT_ACCOUNT";
  entityId: string;
  amountPence?: number;
  meta?: {
    receiptNumber?: string | null;
    visibility?: string;
    sourceType?: string;
    sourceRef?: string;
    authorName?: string | null;
  };
};

type TimelineResponse = {
  customer: Customer;
  timeline: TimelineItem[];
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const typeLabel: Record<TimelineItem["type"], string> = {
  CUSTOMER_CREATED: "Customer",
  SALE_COMPLETED: "Sale",
  WORKSHOP_CREATED: "Workshop",
  WORKSHOP_COMPLETED: "Workshop",
  WORKSHOP_NOTE: "Note",
  CREDIT_ENTRY: "Credit",
};

export const CustomerTimelinePage = () => {
  const { id } = useParams<{ id: string }>();
  const { error } = useToasts();
  const [payload, setPayload] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTimeline = async () => {
    if (!id) {
      return;
    }
    setLoading(true);
    try {
      const nextPayload = await apiGet<TimelineResponse>(`/api/customers/${encodeURIComponent(id)}/timeline`);
      setPayload(nextPayload);
    } catch (loadError) {
      setPayload(null);
      error(loadError instanceof Error ? loadError.message : "Failed to load customer timeline");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTimeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id) {
    return <div className="page-shell"><p>Missing customer id.</p></div>;
  }

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Customer Timeline</h1>
            <p className="muted-text">
              Chronological internal activity view built from customer, sales, workshop, and credit activity already recorded in CorePOS.
            </p>
          </div>
          <div className="actions-inline">
            <Link to={`/customers/${id}`}>Back to customer</Link>
            <button type="button" onClick={() => void loadTimeline()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {payload ? (
          <div className="job-meta-grid">
            <div><strong>Name:</strong> {payload.customer.name}</div>
            <div><strong>Email:</strong> {payload.customer.email || "-"}</div>
            <div><strong>Phone:</strong> {payload.customer.phone || "-"}</div>
            <div><strong>Events:</strong> {payload.timeline.length}</div>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>Activity Feed</h2>
        <div className="timeline-list">
          {payload?.timeline.length ? payload.timeline.map((item) => (
            <article key={item.id} className="timeline-card">
              <div className="card-header-row">
                <div>
                  <strong>{item.title}</strong>
                  <div className="table-secondary">{new Date(item.occurredAt).toLocaleString()}</div>
                </div>
                <span className="status-badge">{typeLabel[item.type]}</span>
              </div>
              <p>{item.summary}</p>
              <div className="actions-inline">
                {item.entityType === "WORKSHOP_JOB" ? <Link to={`/workshop/${item.entityId}`}>Open workshop job</Link> : null}
                {item.entityType === "CUSTOMER" ? <Link to={`/customers/${payload?.customer.id}`}>Open customer</Link> : null}
                {item.entityType === "SALE" && item.meta?.receiptNumber ? (
                  <a href={toBackendUrl(`/r/${encodeURIComponent(item.meta.receiptNumber)}`)} target="_blank" rel="noreferrer">
                    View receipt
                  </a>
                ) : null}
              </div>
              <div className="job-meta-grid">
                <div><strong>Entity:</strong> {item.entityType}</div>
                <div><strong>ID:</strong> <span className="mono-text">{item.entityId.slice(0, 8)}</span></div>
                {item.amountPence !== undefined ? <div><strong>Amount:</strong> {formatMoney(item.amountPence)}</div> : null}
                {item.meta?.authorName ? <div><strong>Author:</strong> {item.meta.authorName}</div> : null}
                {item.meta?.visibility ? <div><strong>Visibility:</strong> {item.meta.visibility}</div> : null}
                {item.meta?.sourceType ? <div><strong>Source:</strong> {item.meta.sourceType}</div> : null}
              </div>
            </article>
          )) : (
            <div className="restricted-panel info-panel">No customer activity has been recorded yet.</div>
          )}
        </div>
      </section>
    </div>
  );
};
