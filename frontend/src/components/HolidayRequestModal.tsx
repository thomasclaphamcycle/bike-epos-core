import { useEffect, useState } from "react";

type HolidayRequestModalProps = {
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: {
    startDate: string;
    endDate: string;
    requestNotes: string;
  }) => Promise<void>;
};

const todayDateKey = () => {
  const value = new Date();
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const HolidayRequestModal = ({
  open,
  submitting,
  onClose,
  onSubmit,
}: HolidayRequestModalProps) => {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [requestNotes, setRequestNotes] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    const today = todayDateKey();
    setStartDate(today);
    setEndDate(today);
    setRequestNotes("");
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="holiday-request-overlay" role="presentation" onClick={onClose}>
      <div
        className="holiday-request-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Request holiday"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="card-header-row">
          <div>
            <h2>Request Holiday</h2>
            <p className="muted-text">Submit a simple rota holiday request for manager approval.</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting}>Close</button>
        </div>

        <form
          className="holiday-request-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit({
              startDate,
              endDate,
              requestNotes,
            });
          }}
        >
          <div className="holiday-request-form-grid">
            <label>
              Start date
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                required
              />
            </label>
            <label>
              End date
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                required
              />
            </label>
          </div>

          <label>
            Notes
            <textarea
              rows={4}
              value={requestNotes}
              onChange={(event) => setRequestNotes(event.target.value)}
              placeholder="Optional note for the rota reviewer"
            />
          </label>

          <div className="holiday-request-actions">
            <button type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={submitting || !startDate || !endDate}>
              {submitting ? "Submitting..." : "Submit request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
