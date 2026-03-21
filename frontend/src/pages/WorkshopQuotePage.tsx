import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";

type PublicWorkshopQuotePayload = {
  quote: {
    accessStatus: "ACTIVE" | "EXPIRED" | "SUPERSEDED";
    canApprove: boolean;
    canReject: boolean;
    idempotent: boolean;
    customerQuote: {
      publicPath: string;
      expiresAt: string;
      status: "ACTIVE" | "EXPIRED";
    } | null;
  };
  job: {
    id: string;
    status: string;
    scheduledDate: string | null;
    customerName: string;
    bikeDescription: string | null;
    bikeDisplayName: string;
    bike: {
      id: string;
      displayName: string;
      label: string | null;
      make: string | null;
      model: string | null;
      colour: string | null;
    } | null;
  };
  customer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  estimate: {
    id: string;
    workshopJobId: string;
    version: number;
    status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
    labourTotalPence: number;
    partsTotalPence: number;
    subtotalPence: number;
    lineCount: number;
    requestedAt: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
    supersededAt: string | null;
    decisionSource: "STAFF" | "CUSTOMER" | null;
    createdAt: string;
    updatedAt: string;
    isCurrent: boolean;
    lines: Array<{
      id: string;
      type: "LABOUR" | "PART";
      description: string;
      qty: number;
      unitPricePence: number;
      lineTotalPence: number;
      productName: string | null;
      variantName: string | null;
      variantSku: string | null;
    }>;
  };
  customerNotes: Array<{
    id: string;
    note: string;
    createdAt: string;
    authorName: string | null;
  }>;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatOptionalDateTime = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const estimateStatusLabel = (status: PublicWorkshopQuotePayload["estimate"]["status"]) => {
  switch (status) {
    case "PENDING_APPROVAL":
      return "Pending approval";
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
    default:
      return "Draft";
  }
};

const accessStatusLabel = (status: PublicWorkshopQuotePayload["quote"]["accessStatus"]) => {
  switch (status) {
    case "SUPERSEDED":
      return "Superseded";
    case "EXPIRED":
      return "Expired";
    default:
      return "Ready to review";
  }
};

const accessStatusClass = (status: PublicWorkshopQuotePayload["quote"]["accessStatus"]) => {
  switch (status) {
    case "SUPERSEDED":
      return "status-badge status-warning";
    case "EXPIRED":
      return "status-badge status-cancelled";
    default:
      return "status-badge status-complete";
  }
};

const estimateStatusClass = (status: PublicWorkshopQuotePayload["estimate"]["status"]) => {
  switch (status) {
    case "PENDING_APPROVAL":
      return "status-badge status-warning";
    case "APPROVED":
      return "status-badge status-complete";
    case "REJECTED":
      return "status-badge status-cancelled";
    default:
      return "status-badge";
  }
};

export const WorkshopQuotePage = () => {
  const { token: routeToken } = useParams();
  const [searchParams] = useSearchParams();
  const token = routeToken?.trim() || searchParams.get("token")?.trim() || null;
  const [payload, setPayload] = useState<PublicWorkshopQuotePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadQuote = async () => {
    if (!token) {
      setPayload(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const nextPayload = await apiGet<PublicWorkshopQuotePayload>(
        `/api/public/workshop-quotes/${encodeURIComponent(token)}`,
      );
      setPayload(nextPayload);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load quote.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadQuote();
  }, [token]);

  const handleDecision = async (status: "APPROVED" | "REJECTED") => {
    if (!token) {
      return;
    }

    setSubmitting(status);
    setLoadError(null);
    try {
      const nextPayload = await apiPost<PublicWorkshopQuotePayload>(
        `/api/public/workshop-quotes/${encodeURIComponent(token)}`,
        { status },
      );
      setPayload(nextPayload);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not update the quote decision.");
      await loadQuote();
    } finally {
      setSubmitting(null);
    }
  };

  const heading = useMemo(() => {
    if (!payload) {
      return "Workshop quote review";
    }
    return `${payload.job.bikeDisplayName} quote`;
  }, [payload]);

  return (
    <div className="page-shell cash-upload-shell">
      <section className="card cash-upload-card customer-capture-card">
        <div className="cash-upload-heading">
          <span className={payload ? accessStatusClass(payload.quote.accessStatus) : "status-badge"}>
            {payload ? accessStatusLabel(payload.quote.accessStatus) : "Workshop quote"}
          </span>
          <h1>{heading}</h1>
          <p className="muted-text">
            Review the latest workshop estimate and let the shop know whether you&apos;d like them to continue with this work.
          </p>
        </div>

        {loading ? <p>Loading quote...</p> : null}

        {!loading && loadError ? (
          <div className="quick-create-panel">
            <strong>Quote unavailable</strong>
            <p className="muted-text">{loadError}</p>
            <Link to="/site/workshop">Back to workshop information</Link>
          </div>
        ) : null}

        {!loading && !loadError && !token ? (
          <div className="quick-create-panel">
            <strong>No quote selected</strong>
            <p className="muted-text">Open the secure link from the shop to review your workshop estimate.</p>
          </div>
        ) : null}

        {!loading && !loadError && payload ? (
          <>
            <div className="job-meta-grid">
              <div><strong>Customer:</strong> {payload.job.customerName}</div>
              <div><strong>Bike:</strong> {payload.job.bikeDisplayName}</div>
              <div><strong>Estimate:</strong> <span className={estimateStatusClass(payload.estimate.status)}>v{payload.estimate.version} · {estimateStatusLabel(payload.estimate.status)}</span></div>
              <div><strong>Requested:</strong> {formatOptionalDateTime(payload.estimate.requestedAt)}</div>
              <div><strong>Total:</strong> {formatMoney(payload.estimate.subtotalPence)}</div>
              <div><strong>Quote valid until:</strong> {formatOptionalDateTime(payload.quote.customerQuote?.expiresAt)}</div>
            </div>

            {payload.quote.accessStatus === "SUPERSEDED" ? (
              <div className="quick-create-panel" style={{ marginTop: "12px" }}>
                <strong>This quote is no longer current.</strong>
                <p className="muted-text">
                  The workshop estimate has changed since this link was shared. Please contact the shop for the latest quote before approving any work.
                </p>
              </div>
            ) : null}

            {payload.quote.accessStatus === "EXPIRED" ? (
              <div className="quick-create-panel" style={{ marginTop: "12px" }}>
                <strong>This quote link has expired.</strong>
                <p className="muted-text">Please contact the shop and ask them to send you a fresh quote review link.</p>
              </div>
            ) : null}

            {payload.estimate.status === "APPROVED" ? (
              <div className="success-panel success-panel-sale" style={{ marginTop: "12px" }}>
                <div className="success-panel-heading">
                  <strong>Quote approved</strong>
                  <span className="status-badge status-complete">
                    {payload.estimate.decisionSource === "CUSTOMER" ? "Recorded from this link" : "Recorded by shop"}
                  </span>
                </div>
                <p>The shop now has approval to proceed with the quoted work.</p>
              </div>
            ) : null}

            {payload.estimate.status === "REJECTED" ? (
              <div className="quick-create-panel" style={{ marginTop: "12px" }}>
                <strong>Quote rejected</strong>
                <p className="muted-text">This estimate has been marked as rejected. If you want to revisit it, please contact the shop.</p>
              </div>
            ) : null}

            {payload.quote.accessStatus === "ACTIVE" && payload.quote.canApprove ? (
              <div className="actions-inline" style={{ marginTop: "16px" }}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void handleDecision("APPROVED")}
                  disabled={submitting !== null}
                >
                  {submitting === "APPROVED" ? "Approving..." : "Approve Quote"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDecision("REJECTED")}
                  disabled={submitting !== null}
                >
                  {submitting === "REJECTED" ? "Rejecting..." : "Reject Quote"}
                </button>
              </div>
            ) : null}

            <div className="metric-grid" style={{ marginTop: "16px" }}>
              <div className="metric-card">
                <span className="metric-label">Labour</span>
                <strong className="metric-value">{formatMoney(payload.estimate.labourTotalPence)}</strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">Parts</span>
                <strong className="metric-value">{formatMoney(payload.estimate.partsTotalPence)}</strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">Lines</span>
                <strong className="metric-value">{payload.estimate.lineCount}</strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">Total</span>
                <strong className="metric-value">{formatMoney(payload.estimate.subtotalPence)}</strong>
              </div>
            </div>

            <div className="table-wrap" style={{ marginTop: "16px" }}>
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.estimate.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.type}</td>
                      <td>
                        <div className="table-primary">{line.description}</div>
                        {line.variantSku || line.productName || line.variantName ? (
                          <div className="table-secondary">
                            {[line.productName, line.variantName, line.variantSku].filter(Boolean).join(" · ")}
                          </div>
                        ) : null}
                      </td>
                      <td>{line.qty}</td>
                      <td>{formatMoney(line.unitPricePence)}</td>
                      <td>{formatMoney(line.lineTotalPence)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {payload.customerNotes.length > 0 ? (
              <div className="quick-create-panel" style={{ marginTop: "16px" }}>
                <strong>Notes from the workshop</strong>
                <ul style={{ marginBottom: 0 }}>
                  {payload.customerNotes.map((note) => (
                    <li key={note.id}>
                      {note.note}
                      {note.authorName || note.createdAt ? ` (${[note.authorName, formatOptionalDateTime(note.createdAt)].filter(Boolean).join(" · ")})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
};
