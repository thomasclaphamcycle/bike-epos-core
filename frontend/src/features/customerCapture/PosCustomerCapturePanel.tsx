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
  const timeLeftLabel =
    formatCaptureRelativeMinutes(captureSession?.expiresAt, { suffix: "left" }) ?? "timing unavailable";

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
            <div className="table-primary">Tap Customer</div>
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
                {creatingCaptureSession ? "Preparing..." : "Start"}
              </button>
            )
          ) : null}
        </div>

        <div className="pos-customer-capture-state-shell">
          {targetCustomer ? (
            <div className="quick-create-panel pos-customer-capture-state pos-customer-capture-state-compact" data-testid="pos-customer-capture-attached-state">
              <span className="status-badge status-complete">Attached</span>
              <div className="pos-customer-capture-state-copy">
                <strong>Customer already attached</strong>
                <p className="muted-text pos-customer-capture-contact">{formatCustomerContactSummary(targetCustomer)}</p>
              </div>
            </div>
          ) : target?.ownerType === "sale" && target.sale.completedAt ? (
            <div className="quick-create-panel pos-customer-capture-state pos-customer-capture-state-compact" data-testid="pos-customer-capture-ineligible-state">
              <span className="status-badge">Unavailable</span>
              <div className="pos-customer-capture-state-copy">
                <strong>Sale already completed</strong>
              </div>
            </div>
          ) : captureSessionLoading ? (
            <div className="quick-create-panel pos-customer-capture-state pos-customer-capture-state-compact">
              <span className="status-badge">Loading</span>
              <div className="pos-customer-capture-state-copy">
                <strong>Checking status</strong>
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
                <div className="pos-customer-capture-live-heading">
                  <span className="status-badge">Waiting</span>
                  <div className="table-primary pos-customer-capture-live-title">Tap customer phone</div>
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
              <div className="pos-customer-capture-live-meta-row">
                <div className="pos-customer-capture-live-meta">
                  <span data-testid="pos-customer-capture-time-left">{timeLeftLabel}</span>
                </div>
                {captureSessionLaunchMode === "replaced" ? (
                  <span className="muted-text pos-customer-capture-replaced-inline">
                    Previous link expired.
                  </span>
                ) : null}
              </div>
              <details
                className="cash-qr-copy pos-customer-capture-fallback pos-customer-capture-details"
                data-testid="pos-customer-capture-fallback"
              >
                <summary className="pos-customer-capture-details-summary">
                  Fallback
                </summary>
                <div className="pos-customer-capture-fallback-body">
                  <input
                    data-testid="pos-customer-capture-url"
                    aria-label="Fallback capture URL"
                    value={captureUrl}
                    readOnly
                  />
                </div>
                <div className="actions-inline pos-customer-capture-fallback-actions">
                  <button type="button" onClick={onCopyCaptureUrl}>
                    Copy
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
                  <strong>Customer details received</strong>
                  {captureSession.outcome ? (
                    <p className="muted-text">
                      {formatCaptureMatchOutcome(
                        captureSession.outcome.matchType,
                        captureSession.outcome.customer.name,
                      )}
                    </p>
                  ) : null}
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
                <strong>Tap request expired</strong>
              </div>
            </div>
          ) : (
            <div className="quick-create-panel pos-customer-capture-state pos-customer-capture-state-compact" data-testid="pos-customer-capture-ready-state">
              <span className="status-badge status-complete">Ready</span>
              <div className="pos-customer-capture-state-copy">
                <strong data-testid="pos-customer-capture-ready-title">Ready</strong>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
