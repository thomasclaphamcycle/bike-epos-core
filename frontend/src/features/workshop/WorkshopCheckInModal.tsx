import { useEffect } from "react";
import { WorkshopCheckInPage } from "../../pages/WorkshopCheckInPage";

type WorkshopCheckInModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (jobId: string) => Promise<void> | void;
};

export const WorkshopCheckInModal = ({
  open,
  onClose,
  onCreated,
}: WorkshopCheckInModalProps) => {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="workshop-os-modal-backdrop"
      onClick={onClose}
      aria-hidden="true"
    >
      <aside
        className="workshop-os-modal workshop-checkin-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New workshop job"
      >
        <div className="workshop-os-modal__header">
          <div className="workshop-os-drawer__header">
            <div className="workshop-os-overlay-hero__title">
              <p className="ui-page-eyebrow">Workshop Operating Screen</p>
              <h2>New Job</h2>
              <p className="table-secondary">
                Customer, bike, and intake details in one focused creation flow.
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close new job modal">
              Close
            </button>
          </div>
        </div>

        <div className="workshop-os-modal__content workshop-checkin-modal__content">
          <WorkshopCheckInPage embedded onClose={onClose} onCreated={onCreated} />
        </div>
      </aside>
    </div>
  );
};
