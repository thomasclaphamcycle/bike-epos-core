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
  captureSessionLaunchMode: "fresh" | "replaced" | null;
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
  captureSessionLaunchMode,
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
  const startedLabel = formatCaptureRelativeMinutes(captureSession?.createdAt) ?? "just now";
  const timeLeftLabel =
    formatCaptureRelativeMinutes(captureSession?.expiresAt, { suffix: "left" }) ?? "timing unavailable";
  const expiresAtLabel = captureSession?.expiresAt
    ? new Date(captureSession.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <>
      {captureCompletionSummary && targetCustomer?.id === captureCompletionSummary.customer.id ? (
        <div className="success-panel success-panel-sale pos-customer-capture-summary-card" data-testid="pos-customer-capture-success">
          <div className="success-panel-heading pos-customer-capture-summary-heading">
            <div className="pos-customer-capture-state-copy">
              <strong>Customer attached to {getCaptureContextLabel(captureCompletionSummary.ownerType)}</strong>
              <span className="muted-text pos-customer-capture-summary-note">
                {formatCaptureMatchOutcome(captureCompletionSummary.matchType, captureCompletionSummary.customer.name)}
              </span>
            </div>
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
          <div className="pos-customer-capture-summary-grid pos-customer-capture-summary-grid-compact">
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
        </div>
      ) : null}

      <div className="quick-create-panel pos-customer-capture-panel" data-testid="pos-customer-capture-panel">
        <div className="card-header-row pos-customer-capture-header">
          <div className="pos-customer-capture-header-copy">
            <div className="table-primary">NFC Customer Capture</div>
            <p className="muted-text pos-customer-capture-header-note">
              Tap first. Link fallback only when needed.
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
                {creatingCaptureSession ? "Preparing tap request..." : "Start Tap Request"}
              </button>
            )
          ) : null}
        </div>

        {targetCustomer ? (
          <div className="quick-create-panel pos-customer-capture-state pos-customer-capture-state-compact" data-testid="pos-customer-capture-attached-state">
            <span className="status-badge status-complete">Not needed</span>
            <div className="pos-customer-capture-state-copy">
              <strong>Customer already attached</strong>
              <p className="muted-text">
                This {captureContextLabel} already has {targetCustomer.name} attached, so customer capture is finished here.
              </p>
              <p className="muted-text pos-customer-capture-contact">{formatCustomerContactSummary(targetCustomer)}</p>
            </div>
          </div>
        ) : target?.ownerType === "sale" && target.sale.completedAt ? (
          <div className="quick-create-panel pos-customer-capture-state pos-customer-capture-state-compact" data-testid="pos-customer-capture-ineligible-state">
            <span className="status-badge">Unavailable</span>
            <div className="pos-customer-capture-state-copy">
              <strong>Sale already completed</strong>
              <p className="muted-text">
                Customer capture can only run while the sale is still open at the till.
              </p>
            </div>
          </div>
        ) : captureSessionLoading ? (
          <div className="quick-create-panel pos-customer-capture-state pos-customer-capture-state-compact">
            <span className="status-badge">Loading</span>
            <div className="pos-customer-capture-state-copy">
              <strong>Checking customer capture status</strong>
              <p className="muted-text">Loading the latest capture state for this {captureContextLabel}.</p>
            </div>
          </div>
        ) : captureStatusError && !captureSession ? (
          <div className="quick-create-panel pos-customer-capture-state pos-customer-capture-state-compact">
            <span className="status-badge">Error</span>
            <div className="pos-customer-capture-state-copy">
              <strong>Customer capture unavailable</strong>
              <p className="muted-text">{captureStatusError}</p>
            </div>
          </div>
        ) : captureSession?.status === "ACTIVE" && captureUrl ? (
          <div className="cash-qr-card pos-customer-capture-live" data-testid="pos-customer-capture-live-state">
            <div className="card-header-row pos-customer-capture-live-header">
              <div className="pos-customer-capture-state-copy">
                <span className="status-badge">Waiting for customer</span>
                <div className="table-primary pos-customer-capture-live-title">Tap customer phone</div>
                <p className="muted-text pos-customer-capture-header-note">
                  Phone should open the secure capture page for this {captureContextLabel}.
                </p>
              </div>
            </div>
            <div className="pos-customer-capture-live-meta-row">
              <div className="pos-customer-capture-live-meta">
                <span>
                  <strong>Started:</strong> {startedLabel}
                </span>
                <span>
                  <strong>Expires:</strong> {expiresAtLabel || "timing unavailable"}
                </span>
                <span>{timeLeftLabel}</span>
              </div>
              <button
                type="button"
                className="secondary pos-customer-capture-refresh"
                data-testid="pos-customer-capture-refresh"
                onClick={onRefreshStatus}
              >
                Refresh
              </button>
            </div>
            {captureSessionLaunchMode === "replaced" ? (
              <div className="pos-customer-capture-replaced-note">
                <span className="status-badge status-warning">Replaced</span>
                <div className="pos-customer-capture-state-copy">
                  <p className="muted-text">
                    New tap requests expire this link.
                  </p>
                </div>
              </div>
            ) : null}
            <details className="cash-qr-copy pos-customer-capture-fallback pos-customer-capture-details" open>
              <summary className="pos-customer-capture-details-summary">
                Fallback link
              </summary>
              <div className="pos-customer-capture-fallback-heading">
                <p className="muted-text">Use only if tap does not open the page.</p>
              </div>
              <label>
                Capture URL
                <input
                  data-testid="pos-customer-capture-url"
                  value={captureUrl}
                  readOnly
                />
              </label>
              <div className="actions-inline">
                <button type="button" onClick={onCopyCaptureUrl}>
                  Copy link
                </button>
                <a href={captureUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
              </div>
            </details>
          </div>
        ) : captureSession?.status === "COMPLETED" ? (
          <div className="success-panel success-panel-sale pos-customer-capture-state pos-customer-capture-state-compact" data-testid="pos-customer-capture-completed-state">
            <div className="success-panel-heading">
              <div className="pos-customer-capture-state-copy">
                <strong>Customer details received.</strong>
                <p className="muted-text">
                  {captureSession.outcome
                    ? formatCaptureMatchOutcome(
                        captureSession.outcome.matchType,
                        captureSession.outcome.customer.name,
                      )
                    : `The customer has finished on their phone. Refresh the ${captureContextLabel} to pull their details into the till.`}
                </p>
              </div>
              <span className="status-badge status-complete">
                {captureSession.outcome
                  ? getCaptureOutcomeLabel(captureSession.outcome.matchType)
                  : "Ready to attach"}
              </span>
            </div>
          </div>
        ) : captureSession?.status === "EXPIRED" ? (
          <div className="quick-create-panel pos-customer-capture-state pos-customer-capture-state-compact">
            <span className="status-badge">Expired</span>
            <div className="pos-customer-capture-state-copy">
              <strong>Customer capture expired</strong>
              <p className="muted-text">
                The last tap request expired before the customer finished. Start a fresh tap request when they are ready.
              </p>
            </div>
          </div>
        ) : (
          <div className="quick-create-panel pos-customer-capture-state pos-customer-capture-state-compact" data-testid="pos-customer-capture-ready-state">
            <span className="status-badge status-complete">Ready</span>
            <div className="pos-customer-capture-state-copy">
              <strong data-testid="pos-customer-capture-ready-title">Ready for customer capture</strong>
              <p className="muted-text" data-testid="pos-customer-capture-ready-helper">
                Start a tap request when the customer is ready.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
