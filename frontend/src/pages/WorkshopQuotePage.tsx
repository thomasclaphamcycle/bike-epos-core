import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import {
  workshopEstimateStatusClass,
  workshopEstimateStatusLabel,
  workshopQuoteAccessStatusClass,
  workshopQuoteAccessStatusLabel,
} from "../features/workshop/estimateStatus";

type PublicWorkshopPortalPayload = {
  portal: {
    accessStatus: "ACTIVE" | "EXPIRED" | "SUPERSEDED";
    canApprove: boolean;
    canReject: boolean;
    idempotent: boolean;
    linkedEstimateVersion: number;
    currentEstimateVersion: number;
    hasUpdatedEstimate: boolean;
    customerQuote: {
      publicPath: string;
      expiresAt: string;
      status: "ACTIVE" | "EXPIRED";
    } | null;
  };
  customerProgress: {
    stage:
      | "AWAITING_APPROVAL"
      | "BOOKED"
      | "SCHEDULED"
      | "IN_PROGRESS"
      | "WAITING"
      | "READY_FOR_COLLECTION"
      | "COLLECTED"
      | "CLOSED";
    label: string;
    headline: string;
    detail: string;
    nextStep: string;
    needsCustomerAction: boolean;
  };
  job: {
    status: "BOOKED" | "IN_PROGRESS" | "READY" | "COLLECTED" | "CLOSED";
    statusLabel: string;
    createdAt: string;
    updatedAt: string;
    scheduledDate: string | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    durationMinutes: number | null;
    customerName: string;
    bikeDescription: string | null;
    bikeDisplayName: string;
    finalSummary: {
      totalPence: number;
      collectedAt: string | null;
    } | null;
  };
  bike: {
    displayName: string;
    label: string | null;
    make: string | null;
    model: string | null;
    year: number | null;
    bikeType: string | null;
    bikeTypeLabel: string | null;
    colour: string | null;
    wheelSize: string | null;
    frameSize: string | null;
    groupset: string | null;
    motorBrand: string | null;
    motorModel: string | null;
  };
  estimate: {
    version: number;
    status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "SUPERSEDED";
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
      type: "LABOUR" | "PART";
      description: string;
      qty: number;
      unitPricePence: number;
      lineTotalPence: number;
      productName: string | null;
      variantName: string | null;
      variantSku: string | null;
    }>;
  } | null;
  workSummary: {
    labourTotalPence: number;
    partsTotalPence: number;
    subtotalPence: number;
    lineCount: number;
    lines: Array<{
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
    note: string;
    createdAt: string;
  }>;
  timeline: Array<{
    type: string;
    label: string;
    occurredAt: string;
    detail: string | null;
  }>;
};

type PublicWorkshopConversationResponse = {
  conversation: {
    id: string;
    createdAt: string;
    updatedAt: string;
    accessStatus: "ACTIVE" | "EXPIRED" | "SUPERSEDED";
    canReply: boolean;
    messageCount: number;
    lastMessageAt: string | null;
  };
  messages: Array<{
    id: string;
    direction: "OUTBOUND" | "INBOUND";
    channel: "PORTAL" | "EMAIL" | "SMS" | "WHATSAPP" | "INTERNAL_SYSTEM";
    body: string;
    sentAt: string | null;
    receivedAt: string | null;
    createdAt: string;
    senderLabel: string;
  }>;
};

type PublicWorkshopAttachmentsResponse = {
  workshopJobId: string;
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    fileSizeBytes: number;
    createdAt: string;
    updatedAt: string;
    isImage: boolean;
    filePath: string;
  }>;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatOptionalDateTime = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const formatOptionalDate = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB", {
    dateStyle: "medium",
  });
};

const formatScheduledWindow = (job: PublicWorkshopPortalPayload["job"]) => {
  if (job.scheduledStartAt && job.scheduledEndAt) {
    return `${formatOptionalDateTime(job.scheduledStartAt)} to ${new Date(
      job.scheduledEndAt,
    ).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  }

  if (job.scheduledStartAt) {
    return formatOptionalDateTime(job.scheduledStartAt);
  }

  if (job.scheduledDate) {
    return formatOptionalDateTime(job.scheduledDate);
  }

  return "To be confirmed";
};

const customerProgressClass = (
  stage: PublicWorkshopPortalPayload["customerProgress"]["stage"],
) => {
  switch (stage) {
    case "AWAITING_APPROVAL":
    case "WAITING":
      return "status-badge status-warning";
    case "IN_PROGRESS":
      return "status-badge status-info";
    case "READY_FOR_COLLECTION":
      return "status-badge status-ready";
    case "COLLECTED":
      return "status-badge status-complete";
    case "CLOSED":
      return "status-badge status-cancelled";
    default:
      return "status-badge";
  }
};

const portalProgressStepLabels = [
  "Booked",
  "Quote",
  "Workshop",
  "Ready",
  "Collected",
];

const portalProgressStepIndex = (
  stage: PublicWorkshopPortalPayload["customerProgress"]["stage"],
) => {
  switch (stage) {
    case "BOOKED":
    case "SCHEDULED":
      return 0;
    case "AWAITING_APPROVAL":
      return 1;
    case "IN_PROGRESS":
    case "WAITING":
      return 2;
    case "READY_FOR_COLLECTION":
      return 3;
    case "COLLECTED":
    case "CLOSED":
      return 4;
    default:
      return 0;
  }
};

const buildBikeDetails = (bike: PublicWorkshopPortalPayload["bike"]) =>
  [
    bike.label ? { label: "Label", value: bike.label } : null,
    bike.make ? { label: "Make", value: bike.make } : null,
    bike.model ? { label: "Model", value: bike.model } : null,
    bike.year ? { label: "Year", value: `${bike.year}` } : null,
    bike.bikeTypeLabel ? { label: "Bike Type", value: bike.bikeTypeLabel } : null,
    bike.colour ? { label: "Colour", value: bike.colour } : null,
    bike.wheelSize ? { label: "Wheel Size", value: bike.wheelSize } : null,
    bike.frameSize ? { label: "Frame Size", value: bike.frameSize } : null,
    bike.groupset ? { label: "Groupset", value: bike.groupset } : null,
    bike.motorBrand ? { label: "Motor Brand", value: bike.motorBrand } : null,
    bike.motorModel ? { label: "Motor Model", value: bike.motorModel } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);

const renderLineMeta = (
  line: PublicWorkshopPortalPayload["workSummary"]["lines"][number],
) => [line.productName, line.variantName, line.variantSku].filter(Boolean).join(" · ");

export const WorkshopQuotePage = () => {
  const { token: routeToken } = useParams();
  const [searchParams] = useSearchParams();
  const token = routeToken?.trim() || searchParams.get("token")?.trim() || null;
  const [payload, setPayload] = useState<PublicWorkshopPortalPayload | null>(null);
  const [conversationPayload, setConversationPayload] =
    useState<PublicWorkshopConversationResponse | null>(null);
  const [attachmentsPayload, setAttachmentsPayload] =
    useState<PublicWorkshopAttachmentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [conversationLoading, setConversationLoading] = useState(true);
  const [attachmentsLoading, setAttachmentsLoading] = useState(true);
  const [submitting, setSubmitting] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replying, setReplying] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null);

  const loadPortal = async () => {
    if (!token) {
      setPayload(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    try {
      const nextPayload = await apiGet<PublicWorkshopPortalPayload>(
        `/api/public/workshop/${encodeURIComponent(token)}`,
      );
      setPayload(nextPayload);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load workshop update.");
    } finally {
      setLoading(false);
    }
  };

  const loadConversation = async () => {
    if (!token) {
      setConversationPayload(null);
      setConversationLoading(false);
      setConversationError(null);
      return;
    }

    setConversationLoading(true);
    setConversationError(null);

    try {
      const nextPayload = await apiGet<PublicWorkshopConversationResponse>(
        `/api/public/workshop/${encodeURIComponent(token)}/conversation`,
      );
      setConversationPayload(nextPayload);
    } catch (error) {
      setConversationError(
        error instanceof Error ? error.message : "Failed to load workshop conversation.",
      );
    } finally {
      setConversationLoading(false);
    }
  };

  const loadAttachments = async () => {
    if (!token) {
      setAttachmentsPayload(null);
      setAttachmentsLoading(false);
      setAttachmentsError(null);
      return;
    }

    setAttachmentsLoading(true);
    setAttachmentsError(null);

    try {
      const nextPayload = await apiGet<PublicWorkshopAttachmentsResponse>(
        `/api/public/workshop/${encodeURIComponent(token)}/attachments`,
      );
      setAttachmentsPayload(nextPayload);
    } catch (error) {
      setAttachmentsError(
        error instanceof Error ? error.message : "Failed to load workshop attachments.",
      );
    } finally {
      setAttachmentsLoading(false);
    }
  };

  useEffect(() => {
    void Promise.all([loadPortal(), loadConversation(), loadAttachments()]);
  }, [token]);

  const handleDecision = async (status: "APPROVED" | "REJECTED") => {
    if (!token) {
      return;
    }

    setSubmitting(status);
    setLoadError(null);

    try {
      const nextPayload = await apiPost<PublicWorkshopPortalPayload>(
        `/api/public/workshop/${encodeURIComponent(token)}/decision`,
        { status },
      );
      setPayload(nextPayload);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not update your workshop quote decision.",
      );
      await loadPortal();
    } finally {
      setSubmitting(null);
    }
  };

  const handleReply = async () => {
    if (!token) {
      return;
    }

    setReplying(true);
    setConversationError(null);

    try {
      const nextPayload = await apiPost<PublicWorkshopConversationResponse>(
        `/api/public/workshop/${encodeURIComponent(token)}/conversation/messages`,
        { body: replyDraft },
      );
      setConversationPayload(nextPayload);
      setReplyDraft("");
    } catch (error) {
      setConversationError(
        error instanceof Error ? error.message : "Could not send your workshop reply.",
      );
      await loadConversation();
    } finally {
      setReplying(false);
    }
  };

  const pageTitle = useMemo(() => {
    if (!payload) {
      return "Workshop job update";
    }

    return `${payload.bike.displayName} workshop update`;
  }, [payload]);

  const bikeDetails = payload ? buildBikeDetails(payload.bike) : [];
  const estimateLines = payload?.estimate?.lines ?? [];
  const workLines = payload?.workSummary.lines ?? [];
  const conversationMessages = conversationPayload?.messages ?? [];
  const attachments = attachmentsPayload?.attachments ?? [];
  const latestTimelineEvent = payload?.timeline[payload.timeline.length - 1] ?? null;
  const progressStepIndex = payload ? portalProgressStepIndex(payload.customerProgress.stage) : 0;

  return (
    <div className="workshop-portal-shell">
      <section className="workshop-portal-card">
        <div className="workshop-portal-hero">
          <div className="workshop-portal-badges">
            <span
              className={payload ? customerProgressClass(payload.customerProgress.stage) : "status-badge"}
            >
              {payload ? payload.customerProgress.label : "Workshop update"}
            </span>
            <span
              className={payload ? workshopQuoteAccessStatusClass(payload.portal.accessStatus) : "status-badge"}
            >
              {payload ? workshopQuoteAccessStatusLabel(payload.portal.accessStatus) : "Portal"}
            </span>
            {payload?.estimate ? (
              <span className={workshopEstimateStatusClass(payload.estimate.status)}>
                {workshopEstimateStatusLabel(payload.estimate.status, "customer")}
              </span>
            ) : null}
          </div>
          <p className="workshop-portal-kicker">Secure workshop portal</p>
          <h1>{pageTitle}</h1>
          <p className="workshop-portal-headline">
            {payload?.customerProgress.headline ??
              "Follow your repair progress, review quoted work, and reply to the workshop team here."}
          </p>
          <p className="muted-text">
            {payload?.customerProgress.detail ??
              "Use this secure page to follow your bike job, review any quoted work, and read or send workshop updates."}
          </p>
        </div>

        {loading ? <p>Loading workshop update...</p> : null}

        {!loading && loadError ? (
          <div className="quick-create-panel">
            <strong>Workshop update unavailable</strong>
            <p className="muted-text">{loadError}</p>
            <Link to="/site/workshop">Back to workshop information</Link>
          </div>
        ) : null}

        {!loading && !loadError && !token ? (
          <div className="quick-create-panel">
            <strong>No workshop link selected</strong>
            <p className="muted-text">Open the secure workshop link from the shop to review your bike job.</p>
          </div>
        ) : null}

        {!loading && !loadError && payload ? (
          <>
            <div className="workshop-portal-summary-grid">
              <section className="workshop-portal-summary-card workshop-portal-summary-card--highlight">
                <span className="workshop-portal-summary-label">What happens next</span>
                <strong className="workshop-portal-summary-value">{payload.customerProgress.nextStep}</strong>
                <p className="workshop-portal-summary-detail">
                  {payload.customerProgress.needsCustomerAction
                    ? "The workshop is waiting for your decision before they continue."
                    : latestTimelineEvent
                      ? `Last update: ${latestTimelineEvent.label} on ${formatOptionalDateTime(
                          latestTimelineEvent.occurredAt,
                        )}`
                      : `Last updated ${formatOptionalDateTime(payload.job.updatedAt)}`}
                </p>
              </section>
              <section className="workshop-portal-summary-card">
                <span className="workshop-portal-summary-label">Scheduled time</span>
                <strong className="workshop-portal-summary-value">
                  {formatScheduledWindow(payload.job)}
                </strong>
                <p className="workshop-portal-summary-detail">
                  {payload.job.durationMinutes
                    ? `${payload.job.durationMinutes} minute workshop slot`
                    : "The workshop will confirm timing here if it changes."}
                </p>
              </section>
              <section className="workshop-portal-summary-card">
                <span className="workshop-portal-summary-label">
                  {payload.estimate ? "Current quote total" : "Current work subtotal"}
                </span>
                <strong className="workshop-portal-summary-value">
                  {payload.estimate
                    ? formatMoney(payload.estimate.subtotalPence)
                    : formatMoney(payload.workSummary.subtotalPence)}
                </strong>
                <p className="workshop-portal-summary-detail">
                  {payload.estimate
                    ? `${payload.estimate.lineCount} quoted line${
                        payload.estimate.lineCount === 1 ? "" : "s"
                      }`
                    : `${payload.workSummary.lineCount} work line${
                        payload.workSummary.lineCount === 1 ? "" : "s"
                      }`}
                </p>
              </section>
              <section className="workshop-portal-summary-card">
                <span className="workshop-portal-summary-label">
                  {payload.job.finalSummary ? "Collection total" : "Portal access"}
                </span>
                <strong className="workshop-portal-summary-value">
                  {payload.job.finalSummary
                    ? formatMoney(payload.job.finalSummary.totalPence)
                    : workshopQuoteAccessStatusLabel(payload.portal.accessStatus)}
                </strong>
                <p className="workshop-portal-summary-detail">
                  {payload.job.finalSummary?.collectedAt
                    ? `Collected ${formatOptionalDateTime(payload.job.finalSummary.collectedAt)}`
                    : payload.portal.customerQuote?.expiresAt
                      ? `Approval link valid until ${formatOptionalDateTime(
                          payload.portal.customerQuote.expiresAt,
                        )}`
                      : "Use this secure page for updates, notes, attachments, and messages."}
                </p>
              </section>
            </div>

            <section className="workshop-portal-panel workshop-portal-progress">
              <div className="card-header-row">
                <div>
                  <h2>Repair progress</h2>
                  <p className="table-secondary">
                    A simple view of where your bike is in the workshop process.
                  </p>
                </div>
                <span className={customerProgressClass(payload.customerProgress.stage)}>
                  {payload.customerProgress.label}
                </span>
              </div>
              <ol className="workshop-portal-progress-steps">
                {portalProgressStepLabels.map((label, index) => {
                  const stepState =
                    index < progressStepIndex
                      ? "complete"
                      : index === progressStepIndex
                        ? "current"
                        : "upcoming";
                  return (
                    <li
                      key={label}
                      className={`workshop-portal-progress-step workshop-portal-progress-step--${stepState}`}
                    >
                      <span className="workshop-portal-progress-step-number">{index + 1}</span>
                      <div>
                        <strong>{label}</strong>
                        {index === progressStepIndex ? (
                          <p className="muted-text">{payload.customerProgress.detail}</p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            <div className="workshop-portal-grid">
              <section className="workshop-portal-panel">
                <div className="card-header-row">
                  <div>
                    <h2>Job summary</h2>
                    <p className="table-secondary">
                      The key workshop details most customers usually ask for first.
                    </p>
                  </div>
                  <span className="table-secondary">{payload.job.statusLabel}</span>
                </div>
                <div className="job-meta-grid">
                  <div><strong>Bike:</strong> {payload.bike.displayName}</div>
                  <div><strong>Customer:</strong> {payload.job.customerName}</div>
                  <div><strong>Current status:</strong> {payload.job.statusLabel}</div>
                  <div><strong>Booked:</strong> {formatOptionalDateTime(payload.job.createdAt)}</div>
                  <div><strong>Scheduled:</strong> {formatScheduledWindow(payload.job)}</div>
                  <div><strong>Duration:</strong> {payload.job.durationMinutes ? `${payload.job.durationMinutes} min` : "-"}</div>
                  <div><strong>Latest update:</strong> {formatOptionalDateTime(payload.job.updatedAt)}</div>
                  <div><strong>Quote link valid until:</strong> {formatOptionalDateTime(payload.portal.customerQuote?.expiresAt)}</div>
                  <div><strong>Collection total:</strong> {payload.job.finalSummary ? formatMoney(payload.job.finalSummary.totalPence) : "-"}</div>
                  <div><strong>Last timeline event:</strong> {latestTimelineEvent ? latestTimelineEvent.label : "-"}</div>
                </div>
              </section>

              <section className="workshop-portal-panel">
                <div className="card-header-row">
                  <div>
                    <h2>Bike summary</h2>
                    <p className="table-secondary">
                      The bike details the workshop has linked to this job.
                    </p>
                  </div>
                </div>
                <p className="workshop-portal-bike-name">{payload.bike.displayName}</p>
                {bikeDetails.length > 0 ? (
                  <dl className="workshop-portal-detail-list">
                    {bikeDetails.map((detail) => (
                      <div key={detail.label}>
                        <dt>{detail.label}</dt>
                        <dd>{detail.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="muted-text">The shop has not added extra bike profile details yet.</p>
                )}
              </section>
            </div>

            {payload.portal.accessStatus === "SUPERSEDED" ? (
              <div className="quick-create-panel workshop-portal-alert">
                <strong>The quote has changed since this link was first sent.</strong>
                <p className="muted-text">
                  This secure link was originally shared for quote v{payload.portal.linkedEstimateVersion}. The workshop
                  has since updated the estimate
                  {payload.portal.currentEstimateVersion
                    ? ` to v${payload.portal.currentEstimateVersion}`
                    : ""}. Please review the latest work summary below and contact the shop for a fresh approval request.
                </p>
              </div>
            ) : null}

            {payload.portal.accessStatus === "EXPIRED" ? (
              <div className="quick-create-panel workshop-portal-alert">
                <strong>This approval link has expired.</strong>
                <p className="muted-text">
                  You can still review the current workshop summary here, but you&apos;ll need a fresh link from the shop to approve or reject any quoted work.
                </p>
              </div>
            ) : null}

            {payload.estimate?.status === "APPROVED" ? (
              <div className="success-panel success-panel-sale">
                <div className="success-panel-heading">
                  <strong>Quote approved</strong>
                  <span className="status-badge status-complete">
                    {payload.estimate.decisionSource === "CUSTOMER" ? "Approved from this portal" : "Approved with the shop"}
                  </span>
                </div>
                <p>The workshop now has approval to continue with the quoted work.</p>
              </div>
            ) : null}

            {payload.estimate?.status === "REJECTED" ? (
              <div className="quick-create-panel workshop-portal-alert">
                <strong>Quote rejected</strong>
                <p className="muted-text">
                  This estimate has been marked as rejected. If you want to revisit it, please contact the shop directly.
                </p>
              </div>
            ) : null}

            {payload.portal.accessStatus === "ACTIVE" && payload.portal.canApprove ? (
              <div className="workshop-portal-cta">
                <div>
                  <strong>Action needed</strong>
                  <p className="muted-text">
                    Review the quote below and tell the workshop whether they can continue with this work.
                  </p>
                </div>
                <div className="actions-inline">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void handleDecision("APPROVED")}
                    disabled={submitting !== null}
                  >
                    {submitting === "APPROVED" ? "Approving..." : "Approve Quoted Work"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDecision("REJECTED")}
                    disabled={submitting !== null}
                  >
                    {submitting === "REJECTED" ? "Rejecting..." : "Reject Quote"}
                  </button>
                </div>
              </div>
            ) : null}

            {payload.estimate ? (
              <section className="workshop-portal-panel">
                <div className="card-header-row">
                  <div>
                    <h2>Current quote</h2>
                    <p className="table-secondary">
                      Version {payload.estimate.version}
                      {payload.portal.hasUpdatedEstimate &&
                      payload.portal.currentEstimateVersion !== payload.portal.linkedEstimateVersion
                        ? ` · updated from v${payload.portal.linkedEstimateVersion}`
                        : ""}
                    </p>
                  </div>
                  <span className={workshopEstimateStatusClass(payload.estimate.status)}>
                    {workshopEstimateStatusLabel(payload.estimate.status, "customer")}
                  </span>
                </div>
                <p className="muted-text">
                  This is the quoted work the shop wants you to review. If approval is still needed, your decision here
                  feeds straight back into the live workshop job.
                </p>

                <div className="metric-grid">
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

                <div className="job-meta-grid" style={{ marginTop: "12px" }}>
                  <div><strong>Requested:</strong> {formatOptionalDateTime(payload.estimate.requestedAt)}</div>
                  <div><strong>Approved:</strong> {formatOptionalDateTime(payload.estimate.approvedAt)}</div>
                  <div><strong>Rejected:</strong> {formatOptionalDateTime(payload.estimate.rejectedAt)}</div>
                </div>

                {estimateLines.length > 0 ? (
                  <div className="table-wrap" style={{ marginTop: "16px" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Work</th>
                          <th>Qty</th>
                          <th>Unit</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {estimateLines.map((line, index) => (
                          <tr key={`${line.type}-${line.description}-${index}`}>
                            <td>{line.type === "LABOUR" ? "Labour" : "Part"}</td>
                            <td>
                              <div className="table-primary">{line.description}</div>
                              {renderLineMeta(line) ? (
                                <div className="table-secondary">{renderLineMeta(line)}</div>
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
                ) : (
                  <p className="muted-text" style={{ marginTop: "12px" }}>No quoted lines have been saved for this job yet.</p>
                )}
              </section>
            ) : null}

            <section className="workshop-portal-panel">
              <div className="card-header-row">
                <div>
                  <h2>Current work summary</h2>
                  <p className="table-secondary">
                    A live summary of the labour and parts currently recorded on this job.
                  </p>
                </div>
              </div>
              <div className="metric-grid">
                <div className="metric-card">
                  <span className="metric-label">Labour</span>
                  <strong className="metric-value">{formatMoney(payload.workSummary.labourTotalPence)}</strong>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Parts</span>
                  <strong className="metric-value">{formatMoney(payload.workSummary.partsTotalPence)}</strong>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Lines</span>
                  <strong className="metric-value">{payload.workSummary.lineCount}</strong>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Subtotal</span>
                  <strong className="metric-value">{formatMoney(payload.workSummary.subtotalPence)}</strong>
                </div>
              </div>

              {workLines.length > 0 ? (
                <div className="table-wrap" style={{ marginTop: "16px" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Summary</th>
                        <th>Qty</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workLines.map((line, index) => (
                        <tr key={`${line.type}-${line.description}-${index}`}>
                          <td>{line.type === "LABOUR" ? "Labour" : "Part"}</td>
                          <td>
                            <div className="table-primary">{line.description}</div>
                            {renderLineMeta(line) ? (
                              <div className="table-secondary">{renderLineMeta(line)}</div>
                            ) : null}
                          </td>
                          <td>{line.qty}</td>
                          <td>{formatMoney(line.lineTotalPence)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted-text" style={{ marginTop: "12px" }}>
                  The workshop has not added any labour or parts lines yet.
                </p>
              )}
            </section>

            <section className="workshop-portal-panel" style={{ marginTop: "16px" }}>
              <div className="card-header-row">
                <div>
                  <h2>Message thread</h2>
                  <p className="table-secondary">
                    Read updates from the workshop and reply here while this secure link remains active.
                  </p>
                </div>
                <span className="table-secondary">
                  {conversationPayload?.conversation.messageCount ?? 0} message
                  {(conversationPayload?.conversation.messageCount ?? 0) === 1 ? "" : "s"}
                </span>
              </div>

              {conversationLoading ? <p>Loading conversation...</p> : null}
              {!conversationLoading && conversationError ? (
                <p className="muted-text">{conversationError}</p>
              ) : null}

              {!conversationLoading && !conversationError && conversationMessages.length === 0 ? (
                <p className="muted-text">The workshop has not added any direct messages yet.</p>
              ) : (
                <div className="conversation-thread conversation-thread--portal">
                  {conversationMessages.map((message) => (
                    <article
                      key={message.id}
                      className={`conversation-message-card conversation-message-card--${
                        message.direction === "OUTBOUND" ? "outbound" : "inbound"
                      }`}
                    >
                      <div className="note-card-header">
                        <span
                          className={
                            message.direction === "OUTBOUND"
                              ? "status-badge status-info"
                              : "status-badge status-complete"
                          }
                        >
                          {message.direction === "OUTBOUND" ? "Workshop update" : "Your reply"}
                        </span>
                        <span className="table-secondary">
                          {formatOptionalDateTime(
                            message.sentAt ?? message.receivedAt ?? message.createdAt,
                          )}
                        </span>
                      </div>
                      <p>{message.body}</p>
                      <div className="table-secondary">{message.senderLabel}</div>
                    </article>
                  ))}
                </div>
              )}

              <div className="note-form-grid" style={{ marginTop: "8px" }}>
                <label className="note-form-wide">
                  Reply to the workshop
                  <textarea
                    value={replyDraft}
                    onChange={(event) => setReplyDraft(event.target.value)}
                    placeholder="Send a reply to the workshop team"
                    disabled={!conversationPayload?.conversation.canReply}
                  />
                </label>
                <div className="actions-inline">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void handleReply()}
                    disabled={
                      replying ||
                      !replyDraft.trim() ||
                      !conversationPayload?.conversation.canReply
                    }
                  >
                    {replying ? "Sending..." : "Send Reply"}
                  </button>
                </div>
              </div>

              {!conversationPayload?.conversation.canReply ? (
                <p className="muted-text">
                  Replies are only available while this secure workshop link is still active. You can still read the full
                  conversation history here.
                </p>
              ) : null}
            </section>

            <section className="workshop-portal-panel" style={{ marginTop: "16px" }}>
              <div className="card-header-row">
                <div>
                  <h2>Shared photos &amp; files</h2>
                  <p className="table-secondary">
                    The workshop can share customer-visible photos or PDFs here when they help explain the job.
                  </p>
                </div>
                <span className="table-secondary">
                  {attachments.length} attachment{attachments.length === 1 ? "" : "s"}
                </span>
              </div>

              {attachmentsLoading ? <p>Loading attachments...</p> : null}
              {!attachmentsLoading && attachmentsError ? (
                <p className="muted-text">{attachmentsError}</p>
              ) : null}
              {!attachmentsLoading && !attachmentsError && attachments.length === 0 ? (
                <p className="muted-text">The workshop has not shared any customer-visible attachments yet.</p>
              ) : null}

              {!attachmentsLoading && !attachmentsError && attachments.length > 0 ? (
                <div className="attachment-grid attachment-grid--portal">
                  {attachments.map((attachment) => (
                    <article key={attachment.id} className="attachment-card">
                      {attachment.isImage ? (
                        <a href={attachment.filePath} target="_blank" rel="noreferrer" className="attachment-preview-link">
                          <img
                            src={attachment.filePath}
                            alt={attachment.filename}
                            className="attachment-preview-image"
                          />
                        </a>
                      ) : (
                        <div className="attachment-preview-file">PDF</div>
                      )}
                      <div className="table-primary">{attachment.filename}</div>
                      <div className="table-secondary">
                        {formatFileSize(attachment.fileSizeBytes)} · {formatOptionalDateTime(attachment.createdAt)}
                      </div>
                      <div className="actions-inline">
                        <a href={attachment.filePath} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>

            <div className="workshop-portal-grid">
              <section className="workshop-portal-panel">
                <h2>Notes from the workshop</h2>
                {payload.customerNotes.length > 0 ? (
                  <ul className="workshop-portal-timeline">
                    {payload.customerNotes.map((note, index) => (
                      <li key={`${note.createdAt}-${index}`}>
                        <div className="workshop-portal-timeline-marker" />
                        <div>
                          <strong>{formatOptionalDate(note.createdAt)}</strong>
                          <p>{note.note}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-text">The shop has not added any customer-visible notes yet.</p>
                )}
              </section>

              <section className="workshop-portal-panel">
                <div className="card-header-row">
                  <div>
                    <h2>Timeline</h2>
                    <p className="table-secondary">
                      A simple record of the main customer-facing milestones for this job.
                    </p>
                  </div>
                </div>
                {payload.timeline.length > 0 ? (
                  <ol className="workshop-portal-timeline">
                    {payload.timeline.map((event, index) => (
                      <li key={`${event.type}-${event.occurredAt}-${index}`}>
                        <div className="workshop-portal-timeline-marker" />
                        <div>
                          <strong>{event.label}</strong>
                          <p>{formatOptionalDateTime(event.occurredAt)}</p>
                          {event.detail ? <p className="muted-text">{event.detail}</p> : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted-text">No customer-facing timeline updates are available yet.</p>
                )}
              </section>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
};
