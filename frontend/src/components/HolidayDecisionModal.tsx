import { useEffect, useState } from "react";
import type { HolidayRequestItem } from "./HolidayRequestsPanel";

type HolidayDecisionModalProps = {
  open: boolean;
  mode: "approve" | "reject";
  request: HolidayRequestItem | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (decisionNotes: string) => Promise<void>;
};

const formatDate = (value: string) => new Date(`${value}T12:00:00.000Z`).toLocaleDateString("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export const HolidayDecisionModal = ({
  open,
  mode,
  request,
  submitting,
  onClose,
  onSubmit,
}: HolidayDecisionModalProps) => {
  const [decisionNotes, setDecisionNotes] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setDecisionNotes("");
  }, [open, mode, request?.id]);

  if (!open || !request) {
    return null;
  }

  const title = mode === "approve" ? "Approve Holiday Request" : "Reject Holiday Request";
  const actionLabel = mode === "approve" ? "Approve request" : "Reject request";

  return (
    <div className="holiday-request-overlay" role="presentation" onClick={onClose}>
      <div
        className="holiday-request-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="card-header-row">
          <div>
            <h2>{title}</h2>
            <p className="muted-text">
              {request.staffName} · {formatDate(request.startDate)} to {formatDate(request.endDate)}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting}>Close</button>
        </div>

        <form
          className="holiday-request-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit(decisionNotes);
          }}
        >
          {request.requestNotes ? (
            <div className="restricted-panel info-panel">
              <strong>Request note</strong>
              <div className="muted-text">{request.requestNotes}</div>
            </div>
          ) : null}

          <label>
            Decision notes
            <textarea
              rows={4}
              value={decisionNotes}
              onChange={(event) => setDecisionNotes(event.target.value)}
              placeholder={mode === "approve" ? "Optional note for the staff member" : "Optional explanation for the rejection"}
            />
          </label>

          <div className="holiday-request-actions">
            <button type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className={mode === "approve" ? "primary" : ""} disabled={submitting}>
              {submitting ? "Saving..." : actionLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
