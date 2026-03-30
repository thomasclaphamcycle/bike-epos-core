import { useEffect } from "react";
import {
  WorkshopCheckInPage,
  type WorkshopCheckInScheduleDraft,
} from "../../pages/WorkshopCheckInPage";

type WorkshopCheckInModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (jobId: string) => Promise<void> | void;
  initialScheduleDraft?: WorkshopCheckInScheduleDraft | null;
};

export const WorkshopCheckInModal = ({
  open,
  onClose,
  onCreated,
  initialScheduleDraft = null,
}: WorkshopCheckInModalProps) => {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="workshop-os-modal-backdrop"
      aria-hidden="true"
    >
      <aside
        className="workshop-os-modal workshop-checkin-modal"
        data-testid="workshop-intake"
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
            <button
              type="button"
              className="workshop-os-modal__close-button"
              onClick={onClose}
              aria-label="Close new job modal"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>

        <div className="workshop-os-modal__content workshop-checkin-modal__content">
          <WorkshopCheckInPage
            embedded
            onClose={onClose}
            onCreated={onCreated}
            initialScheduleDraft={initialScheduleDraft}
          />
        </div>
      </aside>
    </div>
  );
};
