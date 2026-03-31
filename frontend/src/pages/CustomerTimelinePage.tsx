import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { toBackendUrl } from "../utils/backendUrl";

type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  summary?: {
    completedSalesCount: number;
    finalizedSpendPence: number;
    activeWorkshopJobsCount: number;
    linkedBikeCount: number;
    mostRecentActivityAt: string;
  };
};

type TimelineItem = {
  id: string;
  type:
    | "CUSTOMER_CREATED"
    | "SALE_COMPLETED"
    | "WORKSHOP_CREATED"
    | "WORKSHOP_STATUS_CHANGED"
    | "WORKSHOP_COMPLETED"
    | "ESTIMATE_UPDATE"
    | "WORKSHOP_NOTE"
    | "CUSTOMER_COMMUNICATION"
    | "BIKE_LINKED"
    | "CREDIT_ENTRY";
  occurredAt: string;
  title: string;
  summary: string;
  entityType: "CUSTOMER" | "SALE" | "WORKSHOP_JOB" | "CREDIT_ACCOUNT" | "BIKE";
  entityId: string;
  amountPence?: number;
  meta?: {
    actorName?: string | null;
    authorName?: string | null;
    bikeDisplayName?: string | null;
    category?: string | null;
    checkoutStaffName?: string | null;
    paymentSummary?: string | null;
    receiptNumber?: string | null;
    receiptUrl?: string | null;
    sourceType?: string | null;
    sourceRef?: string | null;
    visibility?: string | null;
  };
};

type TimelineResponse = {
  customer: Customer;
  timeline: TimelineItem[];
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatOptionalDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "-";

const timelineTypeLabel: Record<TimelineItem["type"], string> = {
  CUSTOMER_CREATED: "Customer",
  SALE_COMPLETED: "Sale",
  WORKSHOP_CREATED: "Workshop",
  WORKSHOP_STATUS_CHANGED: "Status",
  WORKSHOP_COMPLETED: "Completed",
  ESTIMATE_UPDATE: "Estimate",
  WORKSHOP_NOTE: "Note",
  CUSTOMER_COMMUNICATION: "Message",
  BIKE_LINKED: "Bike",
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

  const recentItems = useMemo(() => payload?.timeline ?? [], [payload]);

  if (!id) {
    return <div className="page-shell"><p>Missing customer id.</p></div>;
  }

  return (
    <div className="page-shell">
      <section className="card customer-relationship-profile">
        <div className="bike-service-profile__hero">
          <div className="customer-relationship-profile__identity">
            <span className="bike-service-profile__eyebrow">Customer timeline</span>
            <div className="bike-service-profile__title-row">
              <h1>{payload?.customer.name || "Customer relationship history"}</h1>
              <span className="bike-service-profile__status bike-service-profile__status--calm">
                Durable history
              </span>
            </div>
            <div className="bike-service-profile__highlights">
              <span>{payload?.customer.email || "No email recorded"}</span>
              <span>{payload?.customer.phone || "No phone recorded"}</span>
              <span>{recentItems.length} recorded entries</span>
            </div>
            <p className="bike-service-profile__status-detail">
              Finalized sales, workshop lifecycle activity, customer communication, bikes, and credit entries in one chronology.
            </p>
          </div>
          <div className="bike-service-profile__actions">
            <div className="actions-inline">
              <Link to={`/customers/${id}`}>Back to customer</Link>
              <button type="button" onClick={() => void loadTimeline()} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        </div>

        <div className="bike-service-profile__metrics">
          <div className="customer-booking-summary-card customer-booking-summary-card--highlight">
            <span>Completed sales</span>
            <strong>{payload?.customer.summary?.completedSalesCount ?? 0}</strong>
            <p>Finalized customer-linked sales only.</p>
          </div>
          <div className="customer-booking-summary-card">
            <span>Finalized spend</span>
            <strong>{formatMoney(payload?.customer.summary?.finalizedSpendPence ?? 0)}</strong>
            <p>Conservative commercial total.</p>
          </div>
          <div className="customer-booking-summary-card">
            <span>Active workshop</span>
            <strong>{payload?.customer.summary?.activeWorkshopJobsCount ?? 0}</strong>
            <p>Booked, in progress, or ready to collect.</p>
          </div>
          <div className="customer-booking-summary-card">
            <span>Linked bikes</span>
            <strong>{payload?.customer.summary?.linkedBikeCount ?? 0}</strong>
            <p>Bike records tied to this customer.</p>
          </div>
          <div className="customer-booking-summary-card">
            <span>Most recent activity</span>
            <strong className="bike-service-profile__metric-value--compact">
              {formatOptionalDateTime(payload?.customer.summary?.mostRecentActivityAt)}
            </strong>
            <p>Latest durable customer-linked activity in CorePOS.</p>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Activity feed</h2>
            <p className="muted-text">
              Newest and most commercially useful relationship context first.
            </p>
          </div>
        </div>
        <div className="timeline-list">
          {recentItems.length ? recentItems.map((item) => (
            <article key={item.id} className="timeline-card customer-timeline-card">
              <div className="card-header-row">
                <div>
                  <strong>{item.title}</strong>
                  <div className="table-secondary">{new Date(item.occurredAt).toLocaleString()}</div>
                </div>
                <span className="status-badge">{timelineTypeLabel[item.type]}</span>
              </div>
              <p>{item.summary}</p>
              <div className="job-meta-grid">
                <div><strong>Entity:</strong> {item.entityType}</div>
                <div><strong>Ref:</strong> <span className="mono-text">{item.entityId.slice(0, 8)}</span></div>
                {item.meta?.actorName ? <div><strong>Actor:</strong> {item.meta.actorName}</div> : null}
                {item.meta?.authorName ? <div><strong>Author:</strong> {item.meta.authorName}</div> : null}
                {item.meta?.bikeDisplayName ? <div><strong>Bike:</strong> {item.meta.bikeDisplayName}</div> : null}
                {item.meta?.checkoutStaffName ? <div><strong>Checkout:</strong> {item.meta.checkoutStaffName}</div> : null}
                {item.meta?.paymentSummary ? <div><strong>Payment:</strong> {item.meta.paymentSummary}</div> : null}
                {item.meta?.receiptNumber ? <div><strong>Receipt:</strong> {item.meta.receiptNumber}</div> : null}
                {item.meta?.visibility ? <div><strong>Visibility:</strong> {item.meta.visibility}</div> : null}
                {item.amountPence !== undefined ? <div><strong>Amount:</strong> {formatMoney(item.amountPence)}</div> : null}
                {item.meta?.sourceType ? <div><strong>Source:</strong> {item.meta.sourceType}</div> : null}
              </div>
              <div className="actions-inline">
                {item.entityType === "WORKSHOP_JOB" ? <Link to={`/workshop/${item.entityId}`}>Open workshop job</Link> : null}
                {item.entityType === "CUSTOMER" ? <Link to={`/customers/${payload?.customer.id}`}>Open customer</Link> : null}
                {item.entityType === "BIKE" ? <Link to={`/customers/bikes/${item.entityId}`}>Open bike</Link> : null}
                {item.meta?.receiptUrl ? (
                  <a href={toBackendUrl(item.meta.receiptUrl)} target="_blank" rel="noreferrer">
                    Open receipt
                  </a>
                ) : null}
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
