import type { ReactNode } from "react";
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

type CaptureVisualTone = "neutral" | "ready" | "waiting" | "success" | "danger";

const STAGE_STEPS = [
  { key: "ready", label: "Ready" },
  { key: "waiting", label: "Waiting" },
  { key: "success", label: "Linked" },
] as const;

const getStepState = (
  stepKey: (typeof STAGE_STEPS)[number]["key"],
  activeStep: (typeof STAGE_STEPS)[number]["key"],
) => {
  const stepIndex = STAGE_STEPS.findIndex((step) => step.key === stepKey);
  const activeIndex = STAGE_STEPS.findIndex((step) => step.key === activeStep);

  if (stepIndex < 0 || activeIndex < 0) {
    return "pending";
  }

  if (stepIndex < activeIndex) {
    return "complete";
  }

  if (stepIndex === activeIndex) {
    if (stepKey === "success" && activeStep === "success") {
      return "active-success";
    }

    return "active";
  }

  return "pending";
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
    formatCaptureRelativeMinutes(captureSession?.expiresAt, { suffix: "remaining" }) ?? "timing unavailable";
  const liveSessionWaiting = captureSession?.status === "ACTIVE" && Boolean(captureUrl);

  let stageTone: CaptureVisualTone = "ready";
  let stageLabel = "Ready";
  let stageTitle = "Ready";
  let stageBody: ReactNode = (
    <p className="muted-text pos-customer-capture-support">
      Start a secure tap flow for this {captureContextLabel}.
    </p>
  );
  let stageAction: ReactNode = null;
  let stageTestId = "pos-customer-capture-ready-state";
  let activeStep: (typeof STAGE_STEPS)[number]["key"] = "ready";

  if (targetCustomer) {
    stageTone = "success";
    stageLabel = "Linked";
    stageTitle = "Customer already attached";
    stageBody = (
      <>
        <p className="muted-text pos-customer-capture-support">
          This {captureContextLabel} already has a linked customer.
        </p>
        <p className="muted-text pos-customer-capture-contact">{formatCustomerContactSummary(targetCustomer)}</p>
      </>
    );
    stageTestId = "pos-customer-capture-attached-state";
    activeStep = "success";
  } else if (target?.ownerType === "sale" && target.sale.completedAt) {
    stageTone = "danger";
    stageLabel = "Locked";
    stageTitle = "Sale already completed";
    stageBody = (
      <p className="muted-text pos-customer-capture-support">
        Customer capture is unavailable once the sale has been completed.
      </p>
    );
    stageTestId = "pos-customer-capture-ineligible-state";
  } else if (captureSessionLoading) {
    stageTone = "waiting";
    stageLabel = "Checking";
    stageTitle = "Checking tap status";
    stageBody = (
      <p className="muted-text pos-customer-capture-support">
        Refreshing live capture status.
      </p>
    );
  } else if (captureStatusError && !captureSession) {
    stageTone = "danger";
    stageLabel = "Issue";
    stageTitle = "Customer capture unavailable";
    stageBody = <p className="muted-text pos-customer-capture-support">{captureStatusError}</p>;
  } else if (liveSessionWaiting) {
    stageTone = "waiting";
    stageLabel = "Waiting";
    stageTitle = "Tap customer phone";
    stageBody = (
      <>
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
            Fallback link
          </summary>
          <div className="pos-customer-capture-fallback-body">
            <input
              data-testid="pos-customer-capture-url"
              aria-label="Fallback capture URL"
              value={captureUrl ?? ""}
              readOnly
            />
          </div>
          <div className="actions-inline pos-customer-capture-fallback-actions">
            <button type="button" onClick={onCopyCaptureUrl}>
              Copy
            </button>
            <a href={captureUrl ?? undefined} target="_blank" rel="noreferrer">
              Open
            </a>
          </div>
        </details>
      </>
    );
    stageAction = (
      <button
        type="button"
        className="secondary pos-customer-capture-refresh"
        data-testid="pos-customer-capture-refresh"
        onClick={onRefreshStatus}
      >
        Refresh
      </button>
    );
    stageTestId = "pos-customer-capture-live-state";
    activeStep = "waiting";
  } else if (captureSession?.status === "COMPLETED") {
    stageTone = "success";
    stageLabel = captureSession.outcome
      ? getCaptureOutcomeLabel(captureSession.outcome.matchType)
      : "Linked";
    stageTitle = "Customer details received";
    stageBody = captureSession.outcome ? (
      <p className="muted-text pos-customer-capture-support">
        {formatCaptureMatchOutcome(
          captureSession.outcome.matchType,
          captureSession.outcome.customer.name,
        )}
      </p>
    ) : (
      <p className="muted-text pos-customer-capture-support">
        Ready to attach back to this {captureContextLabel}.
      </p>
    );
    stageTestId = "pos-customer-capture-completed-state";
    activeStep = "success";
  } else if (captureSession?.status === "EXPIRED") {
    stageTone = "danger";
    stageLabel = "Expired";
    stageTitle = "Tap request expired";
    stageBody = (
      <p className="muted-text pos-customer-capture-support">
        Start a new tap request to continue.
      </p>
    );
  }

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
            <p className="pos-customer-capture-eyebrow">NFC capture flow</p>
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
          <div
            className={`pos-customer-capture-stage-card pos-customer-capture-stage-card-${stageTone}`}
            data-testid={stageTestId}
          >
            <div className="pos-customer-capture-stage-rail" aria-hidden="true">
              {STAGE_STEPS.map((step) => (
                <div
                  key={step.key}
                  className={`pos-customer-capture-step pos-customer-capture-step-${getStepState(step.key, activeStep)}`}
                >
                  <span className="pos-customer-capture-step-light" />
                  <span className="pos-customer-capture-step-label">{step.label}</span>
                </div>
              ))}
            </div>

            <div className="pos-customer-capture-stage-main">
              <div className="pos-customer-capture-stage-header">
                <div className="pos-customer-capture-stage-title-wrap">
                  <span className={`status-badge pos-customer-capture-stage-badge pos-customer-capture-stage-badge-${stageTone}`}>
                    {stageLabel}
                  </span>
                  <strong data-testid={stageTestId === "pos-customer-capture-ready-state" ? "pos-customer-capture-ready-title" : undefined}>
                    {stageTitle}
                  </strong>
                </div>
                {stageAction}
              </div>

              <div className="pos-customer-capture-stage-body">
                {stageBody}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
