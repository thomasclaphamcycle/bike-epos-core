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

type HolidayRequestFilterOption = {
  value: string;
  label: string;
};

type HolidayRequestsPanelProps = {
  title: string;
  subtitle: string;
  requests: HolidayRequestItem[];
  loading?: boolean;
  showStaffName?: boolean;
  filterValue?: string;
  filterOptions?: HolidayRequestFilterOption[];
  onFilterChange?: (value: string) => void;
  requestButtonLabel?: string;
  onRequestHoliday?: () => void;
  onApprove?: (request: HolidayRequestItem) => Promise<void>;
  onReject?: (request: HolidayRequestItem) => Promise<void>;
  onCancel?: (request: HolidayRequestItem) => Promise<void>;
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
  showStaffName = true,
  filterValue,
  filterOptions,
  onFilterChange,
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

      {filterOptions?.length && onFilterChange ? (
        <div className="holiday-request-filter-bar" aria-label={`${title} filter`}>
          {filterOptions.map((option) => {
            const isSelected = option.value === filterValue;
            return (
              <button
                key={option.value}
                type="button"
                className={isSelected ? "holiday-request-filter-button holiday-request-filter-button-active" : "holiday-request-filter-button"}
                onClick={() => onFilterChange(option.value)}
                aria-pressed={isSelected}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}

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
                    <strong>
                      {showStaffName
                        ? request.staffName
                        : `${formatDate(request.startDate)} to ${formatDate(request.endDate)}`}
                    </strong>
                    <span className={statusBadgeClassName(request.status)}>{request.status}</span>
                  </div>
                  <div className="holiday-request-meta">
                    {showStaffName ? <span>{formatDate(request.startDate)} to {formatDate(request.endDate)}</span> : null}
                    {showStaffName ? <span>{request.staffRole}</span> : null}
                    <span>{request.requestedDayCount} requested day{request.requestedDayCount === 1 ? "" : "s"}</span>
                    <span>Submitted {formatDateTime(request.submittedAt)}</span>
                  </div>
                  {request.requestNotes ? (
                    <p className="holiday-request-note">
                      <strong>Request note:</strong> {request.requestNotes}
                    </p>
                  ) : null}
                  {request.decisionNotes ? (
                    <p className="holiday-request-note">
                      <strong>Decision note:</strong> {request.decisionNotes}
                    </p>
                  ) : null}
                  {request.reviewedByName || request.reviewedAt ? (
                    <p className="muted-text">
                      {request.reviewedByName ? `Reviewed by ${request.reviewedByName}` : "Reviewed"}
                      {request.reviewedAt ? ` · ${formatDateTime(request.reviewedAt)}` : ""}
                    </p>
                  ) : null}
                </div>
                {isPending && (onApprove || onReject || onCancel) ? (
                  <div className="holiday-request-actions-inline">
                    {onApprove ? (
                      <button type="button" className="primary" onClick={() => void onApprove(request)} disabled={isBusy}>
                        {isBusy ? "Saving..." : "Approve"}
                      </button>
                    ) : null}
                    {onReject ? (
                      <button type="button" onClick={() => void onReject(request)} disabled={isBusy}>
                        Reject
                      </button>
                    ) : null}
                    {onCancel ? (
                      <button type="button" onClick={() => void onCancel(request)} disabled={isBusy}>
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
