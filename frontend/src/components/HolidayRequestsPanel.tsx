export type HolidayRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export type HolidayRequestItem = {
  id: string;
  staffId: string;
  staffName: string;
  staffRole: "STAFF" | "MANAGER" | "ADMIN";
  startDate: string;
  endDate: string;
  status: HolidayRequestStatus;
  requestNotes: string | null;
  decisionNotes: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewedByName: string | null;
  requestedDayCount: number;
};

type HolidayRequestsPanelProps = {
  title: string;
  subtitle: string;
  requests: HolidayRequestItem[];
  loading?: boolean;
  requestButtonLabel?: string;
  onRequestHoliday?: () => void;
  onApprove?: (requestId: string) => Promise<void>;
  onReject?: (requestId: string) => Promise<void>;
  onCancel?: (requestId: string) => Promise<void>;
  busyRequestId?: string | null;
  emptyMessage: string;
};

const statusBadgeClassName = (status: HolidayRequestStatus) => {
  if (status === "APPROVED") {
    return "status-badge staff-status-badge-active";
  }
  if (status === "REJECTED" || status === "CANCELLED") {
    return "status-badge staff-status-badge-inactive";
  }
  return "status-badge status-warning";
};

const formatDate = (value: string) => new Date(`${value}T12:00:00.000Z`).toLocaleDateString("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const formatDateTime = (value: string | null) => {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const HolidayRequestsPanel = ({
  title,
  subtitle,
  requests,
  loading = false,
  requestButtonLabel,
  onRequestHoliday,
  onApprove,
  onReject,
  onCancel,
  busyRequestId = null,
  emptyMessage,
}: HolidayRequestsPanelProps) => {
  return (
    <section className="holiday-requests-panel">
      <div className="card-header-row">
        <div>
          <h3>{title}</h3>
          <p className="muted-text">{subtitle}</p>
        </div>
        {onRequestHoliday && requestButtonLabel ? (
          <button type="button" onClick={onRequestHoliday}>
            {requestButtonLabel}
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="restricted-panel info-panel">Loading holiday requests...</div>
      ) : requests.length ? (
        <div className="holiday-request-list">
          {requests.map((request) => {
            const isBusy = busyRequestId === request.id;
            const isPending = request.status === "PENDING";

            return (
              <article key={request.id} className="holiday-request-card">
                <div className="holiday-request-main">
                  <div className="holiday-request-title-row">
                    <strong>{request.staffName}</strong>
                    <span className={statusBadgeClassName(request.status)}>{request.status}</span>
                  </div>
                  <div className="holiday-request-meta">
                    <span>{formatDate(request.startDate)} to {formatDate(request.endDate)}</span>
                    <span>{request.requestedDayCount} requested day{request.requestedDayCount === 1 ? "" : "s"}</span>
                    <span>Submitted {formatDateTime(request.submittedAt)}</span>
                  </div>
                  {request.requestNotes ? <p className="muted-text">{request.requestNotes}</p> : null}
                  {request.reviewedByName || request.decisionNotes ? (
                    <p className="muted-text">
                      {request.reviewedByName ? `Reviewed by ${request.reviewedByName}` : "Reviewed"}
                      {request.reviewedAt ? ` · ${formatDateTime(request.reviewedAt)}` : ""}
                      {request.decisionNotes ? ` · ${request.decisionNotes}` : ""}
                    </p>
                  ) : null}
                </div>
                {isPending && (onApprove || onReject || onCancel) ? (
                  <div className="holiday-request-actions-inline">
                    {onApprove ? (
                      <button type="button" className="primary" onClick={() => void onApprove(request.id)} disabled={isBusy}>
                        {isBusy ? "Saving..." : "Approve"}
                      </button>
                    ) : null}
                    {onReject ? (
                      <button type="button" onClick={() => void onReject(request.id)} disabled={isBusy}>
                        Reject
                      </button>
                    ) : null}
                    {onCancel ? (
                      <button type="button" onClick={() => void onCancel(request.id)} disabled={isBusy}>
                        Cancel
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="restricted-panel info-panel">{emptyMessage}</div>
      )}
    </section>
  );
};
