import type { CustomerCaptureSession } from "./customerCapture";
import {
  formatCaptureMatchOutcome,
  formatCaptureRelativeMinutes,
  formatCustomerContactSummary,
  getCaptureContextLabel,
  getCaptureOutcomeLabel,
  getCaptureTargetCustomer,
  type CaptureCompletionSummary,
  type PosCustomerCaptureTarget,
} from "./posCustomerCapture";

type PosCustomerCapturePanelProps = {
  target: PosCustomerCaptureTarget | null;
  isCaptureEligible: boolean;
  actionsDisabled?: boolean;
  captureSession: CustomerCaptureSession | null;
  captureSessionLoading: boolean;
  creatingCaptureSession: boolean;
  captureStatusError: string | null;
  captureUrl: string | null;
  captureCompletionSummary: CaptureCompletionSummary | null;
  onDismissCompletion: () => void;
  onCreateCustomerCaptureSession: () => void;
  onCopyCaptureUrl: () => void;
  onRefreshStatus: () => void;
  onRefreshTarget: () => void;
};

export const PosCustomerCapturePanel = ({
  target,
  isCaptureEligible,
  actionsDisabled = false,
  captureSession,
  captureSessionLoading,
  creatingCaptureSession,
  captureStatusError,
  captureUrl,
  captureCompletionSummary,
  onDismissCompletion,
  onCreateCustomerCaptureSession,
  onCopyCaptureUrl,
  onRefreshStatus,
  onRefreshTarget,
}: PosCustomerCapturePanelProps) => {
  const captureContextLabel = getCaptureContextLabel(target?.ownerType ?? "basket");
  const targetCustomer = getCaptureTargetCustomer(target);

  return (
    <>
      {captureCompletionSummary && targetCustomer?.id === captureCompletionSummary.customer.id ? (
        <div className="success-panel success-panel-sale" data-testid="pos-customer-capture-success">
          <div className="success-panel-heading pos-customer-capture-summary-heading">
            <strong>Customer attached to {getCaptureContextLabel(captureCompletionSummary.ownerType)}</strong>
            <span className="status-badge status-complete">
              {getCaptureOutcomeLabel(captureCompletionSummary.matchType)}
            </span>
            <button
              type="button"
              className="link-button"
              data-testid="pos-customer-capture-dismiss"
              onClick={onDismissCompletion}
            >
              Dismiss
            </button>
          </div>
          <div className="pos-customer-capture-summary-grid">
            <div>
              <div className="muted-text">Customer</div>
              <div className="table-primary">
                {targetCustomer?.name || captureCompletionSummary.customer.name}
              </div>
            </div>
            <div>
              <div className="muted-text">Contact</div>
              <div className="table-primary">
                {formatCustomerContactSummary(targetCustomer || captureCompletionSummary.customer)}
              </div>
            </div>
          </div>
          <p>{formatCaptureMatchOutcome(captureCompletionSummary.matchType, captureCompletionSummary.customer.name)}</p>
        </div>
      ) : null}

      <div className="quick-create-panel pos-customer-capture-panel" data-testid="pos-customer-capture-panel">
        <div className="card-header-row">
          <div>
            <div className="table-primary">Add Customer</div>
            <p className="muted-text">
              Ask the customer to tap their phone to add their details.
            </p>
          </div>
          {isCaptureEligible ? (
            captureSession?.status === "COMPLETED" && target ? (
              <button
                type="button"
                className="primary"
                data-testid="pos-customer-capture-refresh-sale"
                onClick={onRefreshTarget}
              >
                Refresh {captureContextLabel}
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                data-testid="pos-customer-capture-generate"
                onClick={onCreateCustomerCaptureSession}
                disabled={actionsDisabled || creatingCaptureSession || captureSessionLoading}
              >
                {creatingCaptureSession ? "Preparing..." : "Start Customer Link"}
              </button>
            )
          ) : null}
        </div>

        {targetCustomer ? (
          <div className="quick-create-panel pos-customer-capture-state" data-testid="pos-customer-capture-attached-state">
            <span className="status-badge status-complete">Not needed</span>
            <strong>Customer already attached</strong>
            <p className="muted-text">
              This {captureContextLabel} already has {targetCustomer.name} attached, so Add Customer is no longer needed here.
            </p>
            <p className="muted-text">
              {formatCustomerContactSummary(targetCustomer)}
            </p>
          </div>
        ) : target?.ownerType === "sale" && target.sale.completedAt ? (
          <div className="quick-create-panel pos-customer-capture-state" data-testid="pos-customer-capture-ineligible-state">
            <span className="status-badge">Unavailable</span>
            <strong>Sale already completed</strong>
            <p className="muted-text">
              Customer capture can only be started while the sale is still active.
            </p>
          </div>
        ) : captureSessionLoading ? (
          <div className="quick-create-panel pos-customer-capture-state">
            <span className="status-badge">Loading</span>
            <strong>Checking current customer capture</strong>
            <p className="muted-text">Loading any active customer capture link for this {captureContextLabel}.</p>
          </div>
        ) : captureStatusError && !captureSession ? (
          <div className="quick-create-panel pos-customer-capture-state">
            <span className="status-badge">Error</span>
            <strong>Customer capture unavailable</strong>
            <p className="muted-text">{captureStatusError}</p>
          </div>
        ) : captureSession?.status === "ACTIVE" && captureUrl ? (
          <div className="cash-qr-card">
            <div className="card-header-row">
              <div>
                <span className="status-badge">Waiting for customer</span>
                <p className="muted-text">
                  Ask the customer to tap their phone to add their details.
                </p>
                <p className="muted-text">
                  Created {formatCaptureRelativeMinutes(captureSession.createdAt) ?? "just now"}.
                  {" "}
                  Expires {new Date(captureSession.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {" "}
                  ({formatCaptureRelativeMinutes(captureSession.expiresAt, { suffix: "remaining" }) ?? "timing unavailable"}).
                </p>
              </div>
            </div>
            <div className="cash-qr-copy">
              <div>
                <div className="table-primary">Need the link instead?</div>
                <p className="muted-text">Copy it or open it directly on the customer&apos;s phone.</p>
              </div>
              <label>
                Public capture URL
                <input
                  data-testid="pos-customer-capture-url"
                  value={captureUrl}
                  readOnly
                />
              </label>
              <div className="actions-inline">
                <button type="button" onClick={onCopyCaptureUrl}>
                  Copy Link
                </button>
                <a href={captureUrl} target="_blank" rel="noreferrer">
                  Open Link
                </a>
                <button type="button" onClick={onRefreshStatus}>
                  Refresh Status
                </button>
              </div>
              <p className="muted-text">
                Starting a new link expires this one immediately.
              </p>
            </div>
          </div>
        ) : captureSession?.status === "COMPLETED" ? (
          <div className="success-panel success-panel-sale" data-testid="pos-customer-capture-completed-state">
            <div className="success-panel-heading">
              <strong>Customer capture complete.</strong>
              <span className="status-badge status-complete">
                {captureSession.outcome
                  ? getCaptureOutcomeLabel(captureSession.outcome.matchType)
                  : "Attached automatically"}
              </span>
            </div>
            <p className="muted-text">
              {captureSession.outcome
                ? formatCaptureMatchOutcome(
                    captureSession.outcome.matchType,
                    captureSession.outcome.customer.name,
                  )
                : `The customer has already finished the form. Refresh the ${captureContextLabel} to pull their details into the till.`}
            </p>
          </div>
        ) : captureSession?.status === "EXPIRED" ? (
          <div className="quick-create-panel pos-customer-capture-state">
            <span className="status-badge">Expired</span>
            <strong>Capture link expired</strong>
            <p className="muted-text">
              The last customer link expired before it was used. Start Customer Link again when the customer is ready.
            </p>
          </div>
        ) : (
          <div className="quick-create-panel pos-customer-capture-state" data-testid="pos-customer-capture-ready-state">
            <span className="status-badge">Ready</span>
            <strong>No live capture link</strong>
            <p className="muted-text">
              Start Customer Link when the customer is ready. CorePOS will then show a fresh public link for this {captureContextLabel}.
            </p>
          </div>
        )}
      </div>
    </>
  );
};
