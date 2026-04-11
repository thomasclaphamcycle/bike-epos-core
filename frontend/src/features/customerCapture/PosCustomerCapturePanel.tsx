import type { SaleCustomerCaptureSession } from "./customerCapture";
import {
  formatCaptureMatchOutcome,
  formatCaptureRelativeMinutes,
  formatCustomerContactSummary,
  getCaptureOutcomeLabel,
  type CaptureCompletionSummary,
  type PosCustomerCaptureSale,
} from "./posCustomerCapture";

type PosCustomerCapturePanelProps = {
  sale: PosCustomerCaptureSale | null;
  isCaptureEligible: boolean;
  captureSession: SaleCustomerCaptureSession | null;
  captureSessionLoading: boolean;
  creatingCaptureSession: boolean;
  captureStatusError: string | null;
  captureQrImage: string | null;
  captureQrBusy: boolean;
  captureUrl: string | null;
  captureCompletionSummary: CaptureCompletionSummary | null;
  onDismissCompletion: () => void;
  onCreateCustomerCaptureSession: () => void;
  onCopyCaptureUrl: () => void;
  onRefreshStatus: () => void;
  onRefreshSale: () => void;
};

export const PosCustomerCapturePanel = ({
  sale,
  isCaptureEligible,
  captureSession,
  captureSessionLoading,
  creatingCaptureSession,
  captureStatusError,
  captureQrImage,
  captureQrBusy,
  captureUrl,
  captureCompletionSummary,
  onDismissCompletion,
  onCreateCustomerCaptureSession,
  onCopyCaptureUrl,
  onRefreshStatus,
  onRefreshSale,
}: PosCustomerCapturePanelProps) => (
  <>
    {captureCompletionSummary && sale?.sale.customer?.id === captureCompletionSummary.customer.id ? (
      <div className="success-panel success-panel-sale" data-testid="pos-customer-capture-success">
        <div className="success-panel-heading pos-customer-capture-summary-heading">
          <strong>Customer attached to sale</strong>
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
              {sale.sale.customer?.name || captureCompletionSummary.customer.name}
            </div>
          </div>
          <div>
            <div className="muted-text">Contact</div>
            <div className="table-primary">
              {formatCustomerContactSummary(sale.sale.customer || captureCompletionSummary.customer)}
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
            Share a QR code or link so the customer can attach their details to this sale from their phone.
          </p>
        </div>
        {isCaptureEligible ? (
          captureSession?.status === "COMPLETED" && sale?.sale.id ? (
            <button
              type="button"
              className="primary"
              data-testid="pos-customer-capture-refresh-sale"
              onClick={onRefreshSale}
            >
              Refresh sale
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              data-testid="pos-customer-capture-generate"
              onClick={onCreateCustomerCaptureSession}
              disabled={creatingCaptureSession || captureSessionLoading}
            >
              {creatingCaptureSession ? "Preparing..." : captureSession ? "Regenerate" : "Start Add Customer"}
            </button>
          )
        ) : null}
      </div>

      {!sale?.sale.id ? (
        <div className="quick-create-panel pos-customer-capture-state" data-testid="pos-customer-capture-no-sale-state">
          <span className="status-badge">Unavailable</span>
          <strong>No active sale yet</strong>
          <p className="muted-text">
            Customer capture becomes available after basket checkout creates a live sale.
          </p>
        </div>
      ) : sale.sale.customer ? (
        <div className="quick-create-panel pos-customer-capture-state" data-testid="pos-customer-capture-attached-state">
          <span className="status-badge status-complete">Not needed</span>
          <strong>Customer already attached</strong>
          <p className="muted-text">
            This sale already has {sale.sale.customer.name} attached, so Add Customer is no longer needed here.
          </p>
          <p className="muted-text">
            {formatCustomerContactSummary(sale.sale.customer)}
          </p>
        </div>
      ) : sale.sale.completedAt ? (
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
          <p className="muted-text">Loading any active customer capture link for this sale.</p>
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
                Scan QR or tap NFC. CorePOS checks for completion automatically, and you can still refresh manually if needed.
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
          <div className="cash-qr-layout">
            <div className="cash-qr-box">
              {captureQrBusy ? (
                <span>Generating QR...</span>
              ) : captureQrImage ? (
                <img
                  src={captureQrImage}
                  alt="Customer capture QR code"
                  data-testid="pos-customer-capture-qr"
                />
              ) : (
                <span>QR unavailable</span>
              )}
            </div>
            <div className="cash-qr-copy">
              <div>
                <div className="table-primary">Need the link instead?</div>
                <p className="muted-text">Copy it or open it directly if the customer cannot scan the QR.</p>
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
                Generating a new link expires this one immediately.
              </p>
            </div>
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
              : "The customer has already finished the form. Refresh the sale to pull their details into the till."}
          </p>
        </div>
      ) : captureSession?.status === "EXPIRED" ? (
        <div className="quick-create-panel pos-customer-capture-state">
          <span className="status-badge">Expired</span>
          <strong>Capture link expired</strong>
          <p className="muted-text">
            The last customer capture link expired before it was used. Start Add Customer again when the customer is ready.
          </p>
        </div>
      ) : (
        <div className="quick-create-panel pos-customer-capture-state" data-testid="pos-customer-capture-ready-state">
          <span className="status-badge">Ready</span>
          <strong>No live capture link</strong>
          <p className="muted-text">
            Start Add Customer when the customer is ready. CorePOS will then show a fresh QR code and public link for this sale.
          </p>
        </div>
      )}
    </div>
  </>
);
