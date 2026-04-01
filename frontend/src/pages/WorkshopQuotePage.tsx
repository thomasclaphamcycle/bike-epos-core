import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { PublicSiteLayout } from "../components/PublicSiteLayout";
import { publicSitePaths } from "../features/publicSite/siteContent";
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
  collection: {
    state:
      | "AWAITING_APPROVAL"
      | "IN_WORKSHOP"
      | "READY_PENDING_CHECKOUT"
      | "READY_PAYMENT_DUE"
      | "READY_TO_COLLECT"
      | "COLLECTED"
      | "CLOSED";
    headline: string;
    detail: string;
    nextStep: string;
    totalPence: number | null;
    outstandingPence: number | null;
    paidPence: number;
    depositPaidPence: number;
    depositRequiredPence: number;
    depositStatus: "NOT_REQUIRED" | "REQUIRED" | "PAID";
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
  estimateChangeSummary: {
    previousVersion: number;
    currentVersion: number | null;
    previousSubtotalPence: number;
    currentSubtotalPence: number;
    differencePence: number;
    changes: Array<{
      changeType: "ADDED" | "REMOVED" | "UPDATED";
      type: "LABOUR" | "PART";
      description: string;
      meta: string | null;
      previousQty: number | null;
      currentQty: number | null;
      previousUnitPricePence: number | null;
      currentUnitPricePence: number | null;
      previousLineTotalPence: number | null;
      currentLineTotalPence: number | null;
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

type WorkshopPortalActionSummary = {
  tone: "action" | "info" | "warning" | "success" | "ready";
  eyebrow: string;
  title: string;
  detail: string;
  nextStep: string;
  primaryLink?: {
    href: string;
    label: string;
  };
  secondaryLink?: {
    href: string;
    label: string;
  };
};

type PublicWorkshopEstimateChange = NonNullable<PublicWorkshopPortalPayload["estimateChangeSummary"]>;

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatSignedMoney = (pence: number) => `${pence >= 0 ? "+" : "-"}${formatMoney(Math.abs(pence))}`;

const truncateText = (value: string, maxLength = 100) => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
};

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

const collectionStatusClass = (
  state: PublicWorkshopPortalPayload["collection"]["state"],
) => {
  switch (state) {
    case "AWAITING_APPROVAL":
      return "status-badge status-warning";
    case "READY_PENDING_CHECKOUT":
    case "READY_PAYMENT_DUE":
    case "READY_TO_COLLECT":
      return "status-badge status-ready";
    case "COLLECTED":
      return "status-badge status-complete";
    case "CLOSED":
      return "status-badge status-cancelled";
    default:
      return "status-badge status-info";
  }
};

const collectionStatusLabel = (
  state: PublicWorkshopPortalPayload["collection"]["state"],
) => {
  switch (state) {
    case "AWAITING_APPROVAL":
      return "Approval outstanding";
    case "READY_PENDING_CHECKOUT":
      return "Ready to collect";
    case "READY_PAYMENT_DUE":
      return "Payment due at collection";
    case "READY_TO_COLLECT":
      return "Nothing left to pay";
    case "COLLECTED":
      return "Collected";
    case "CLOSED":
      return "Closed";
    default:
      return "In workshop";
  }
};

const portalProgressStepLabels = [
  "Booked in",
  "Review quote",
  "In workshop",
  "Ready to collect",
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
    bike.bikeTypeLabel ? { label: "Bike type", value: bike.bikeTypeLabel } : null,
    bike.colour ? { label: "Colour", value: bike.colour } : null,
    bike.wheelSize ? { label: "Wheel size", value: bike.wheelSize } : null,
    bike.frameSize ? { label: "Frame size", value: bike.frameSize } : null,
    bike.groupset ? { label: "Groupset", value: bike.groupset } : null,
    bike.motorBrand ? { label: "Motor brand", value: bike.motorBrand } : null,
    bike.motorModel ? { label: "Motor model", value: bike.motorModel } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);

const renderLineMeta = (
  line: PublicWorkshopPortalPayload["workSummary"]["lines"][number],
) => [line.productName, line.variantName, line.variantSku].filter(Boolean).join(" · ");

const doLineSummariesMatch = (
  left: Array<PublicWorkshopPortalPayload["workSummary"]["lines"][number]>,
  right: Array<PublicWorkshopPortalPayload["workSummary"]["lines"][number]>,
) =>
  left.length === right.length
  && left.every((line, index) => {
    const comparison = right[index];
    return comparison
      && line.type === comparison.type
      && line.description === comparison.description
      && line.qty === comparison.qty
      && line.unitPricePence === comparison.unitPricePence
      && line.lineTotalPence === comparison.lineTotalPence
      && line.productName === comparison.productName
      && line.variantName === comparison.variantName
      && line.variantSku === comparison.variantSku;
  });

const buildWaitingSummary = (payload: PublicWorkshopPortalPayload) => {
  if (payload.portal.canApprove) {
    return {
      label: "Waiting on you",
      detail: "The workshop is paused until you approve the latest quote or tell them not to continue.",
    };
  }

  switch (payload.collection.state) {
    case "READY_PENDING_CHECKOUT":
    case "READY_PAYMENT_DUE":
    case "READY_TO_COLLECT":
      return {
        label: "Waiting on collection",
        detail: "The repair is finished and the next move is handover or collection timing.",
      };
    case "COLLECTED":
      return {
        label: "Complete",
        detail: "The bike has already been handed back.",
      };
    case "CLOSED":
      return {
        label: "Closed",
        detail: "This secure link is now only for reference.",
      };
    default:
      break;
  }

  if (payload.customerProgress.stage === "WAITING") {
    return {
      label: payload.customerProgress.label,
      detail: payload.customerProgress.detail,
    };
  }

  if (payload.customerProgress.stage === "IN_PROGRESS") {
    return {
      label: "Workshop at work",
      detail: "The mechanics are progressing the job and will contact you if anything changes.",
    };
  }

  return {
    label: "Workshop update",
    detail: payload.customerProgress.detail,
  };
};

const buildPortalActionSummary = (
  payload: PublicWorkshopPortalPayload,
): WorkshopPortalActionSummary => {
  if (payload.portal.accessStatus === "SUPERSEDED") {
    const difference = payload.estimateChangeSummary?.differencePence ?? 0;
    return {
      tone: "warning",
      eyebrow: "Quote updated",
      title: "The workshop changed the estimate after this link was first shared",
      detail: payload.estimateChangeSummary
        ? `Version ${payload.estimateChangeSummary.previousVersion} moved to ${payload.estimateChangeSummary.currentVersion !== null ? `version ${payload.estimateChangeSummary.currentVersion}` : "the current live job"} (${formatSignedMoney(
            difference,
          )}). Review the updated work before replying to the shop.`
        : "The workshop has saved a newer quote than the one tied to this link.",
      nextStep:
        "Use the updated quote below as your reference, then ask the workshop to resend a fresh approval link if they still need a decision.",
      primaryLink: { href: "#quote-section", label: "Review latest quote" },
      secondaryLink: { href: "#messages-section", label: "Message the workshop" },
    };
  }

  if (payload.portal.accessStatus === "EXPIRED") {
    return {
      tone: "warning",
      eyebrow: "Link expired",
      title: "You can still review the job, but approval controls are locked",
      detail:
        "This secure approval link has expired. The quote and progress history stay visible here so you can still see where the job stands.",
      nextStep:
        "Contact the shop if they still need your decision or if you want them to resend a current approval link.",
      primaryLink: { href: "#quote-section", label: "Review current quote" },
      secondaryLink: { href: "#messages-section", label: "Ask a question" },
    };
  }

  if (payload.portal.canApprove) {
    return {
      tone: "action",
      eyebrow: "Action needed",
      title: "Review and approve the latest quote",
      detail: payload.estimate
        ? `The workshop is waiting for your decision on ${formatMoney(
            payload.estimate.subtotalPence,
          )} before they continue.`
        : "The workshop is waiting for your decision before they continue.",
      nextStep:
        "Approve to let the workshop continue, or reject if you want them to pause and speak with you first.",
      secondaryLink: { href: "#messages-section", label: "Ask the workshop a question" },
    };
  }

  if (payload.estimate?.status === "APPROVED") {
    return {
      tone: "success",
      eyebrow: "Approved",
      title: "The workshop has the go-ahead to continue",
      detail:
        payload.estimate.decisionSource === "CUSTOMER"
          ? "Your approval was recorded from this secure page."
          : "The workshop has already recorded approval with you.",
      nextStep: payload.customerProgress.nextStep,
      primaryLink: { href: "#messages-section", label: "Message the workshop" },
    };
  }

  if (payload.estimate?.status === "REJECTED") {
    return {
      tone: "warning",
      eyebrow: "Quote declined",
      title: "This quote has been declined",
      detail: "The workshop should now pause and confirm the next plan with you before more work happens.",
      nextStep: "Use the message thread if you want to explain what you would like the shop to do next.",
      primaryLink: { href: "#messages-section", label: "Message the workshop" },
      secondaryLink: { href: "#quote-section", label: "Review quote again" },
    };
  }

  if (
    payload.collection.state === "READY_PENDING_CHECKOUT"
    || payload.collection.state === "READY_PAYMENT_DUE"
    || payload.collection.state === "READY_TO_COLLECT"
  ) {
    return {
      tone: "ready",
      eyebrow: "Collection",
      title: payload.collection.headline,
      detail: payload.collection.detail,
      nextStep: payload.collection.nextStep,
      primaryLink: { href: "#collection-section", label: "Review collection details" },
      secondaryLink: { href: "#messages-section", label: "Message the workshop" },
    };
  }

  return {
    tone: "info",
    eyebrow: "Current status",
    title: payload.customerProgress.headline,
    detail: payload.customerProgress.detail,
    nextStep: payload.customerProgress.nextStep,
    primaryLink: { href: "#messages-section", label: "Open message thread" },
    secondaryLink: { href: "#collection-section", label: "See collection status" },
  };
};

const describeEstimateChange = (
  change: PublicWorkshopEstimateChange["changes"][number],
) => {
  switch (change.changeType) {
    case "ADDED":
      return `Added ${formatMoney(change.currentLineTotalPence ?? 0)}`;
    case "REMOVED":
      return `Removed ${formatMoney(change.previousLineTotalPence ?? 0)}`;
    default:
      if (
        change.previousLineTotalPence !== null
        && change.currentLineTotalPence !== null
        && change.previousLineTotalPence !== change.currentLineTotalPence
      ) {
        return `${formatMoney(change.previousLineTotalPence)} to ${formatMoney(change.currentLineTotalPence)}`;
      }
      return "Updated";
  }
};

const buildLatestActivitySummary = (
  payload: PublicWorkshopPortalPayload,
  messages: PublicWorkshopConversationResponse["messages"],
) => {
  const latestMessage = messages[messages.length - 1] ?? null;
  const latestTimelineEvent = payload.timeline[payload.timeline.length - 1] ?? null;

  const latestMessageAt = latestMessage
    ? new Date(latestMessage.sentAt ?? latestMessage.receivedAt ?? latestMessage.createdAt)
    : null;
  const latestTimelineAt = latestTimelineEvent ? new Date(latestTimelineEvent.occurredAt) : null;

  if (
    latestMessage
    && latestMessageAt
    && !Number.isNaN(latestMessageAt.getTime())
    && (!latestTimelineAt || latestMessageAt.getTime() >= latestTimelineAt.getTime())
  ) {
    return {
      label: latestMessage.direction === "OUTBOUND" ? "Latest workshop message" : "Your latest reply",
      value: formatOptionalDateTime(latestMessage.sentAt ?? latestMessage.receivedAt ?? latestMessage.createdAt),
      detail: truncateText(latestMessage.body, 120),
    };
  }

  if (latestTimelineEvent) {
    return {
      label: "Latest workshop milestone",
      value: formatOptionalDateTime(latestTimelineEvent.occurredAt),
      detail: latestTimelineEvent.detail ?? latestTimelineEvent.label,
    };
  }

  return {
    label: "Latest activity",
    value: formatOptionalDateTime(payload.job.updatedAt),
    detail: "The workshop has not published a customer-facing message or milestone yet.",
  };
};

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
  const progressStepIndex = payload ? portalProgressStepIndex(payload.customerProgress.stage) : 0;
  const waitingSummary = payload ? buildWaitingSummary(payload) : null;
  const actionSummary = payload ? buildPortalActionSummary(payload) : null;
  const latestActivity = payload ? buildLatestActivitySummary(payload, conversationMessages) : null;
  const latestMessage = conversationMessages[conversationMessages.length - 1] ?? null;
  const workSummaryMatchesEstimate = Boolean(
    payload?.estimate
    && payload.estimate.subtotalPence === payload.workSummary.subtotalPence
    && payload.estimate.lineCount === payload.workSummary.lineCount
    && doLineSummariesMatch(payload.estimate.lines, payload.workSummary.lines),
  );

  return (
    <PublicSiteLayout currentNav="repairs">
      <div className="workshop-portal-shell">
        <nav className="public-site-breadcrumbs" aria-label="Repair update breadcrumbs">
          <Link to={publicSitePaths.home}>Overview</Link>
          <span>/</span>
          <Link to={publicSitePaths.repairs}>Repairs</Link>
          <span>/</span>
          <span>Secure update</span>
        </nav>

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
              {payload ? (
                <span className={collectionStatusClass(payload.collection.state)}>
                  {collectionStatusLabel(payload.collection.state)}
                </span>
              ) : null}
            </div>
            <p className="workshop-portal-kicker">Secure workshop portal</p>
            <h1>{pageTitle}</h1>
            <p className="workshop-portal-headline">
              {payload?.customerProgress.headline
                ?? "Follow your repair progress, review quoted work, and reply to the workshop team here."}
            </p>
            <p className="muted-text">
              {payload?.customerProgress.detail
                ?? "Use this secure page to see what the shop is waiting for, what happens next, and how close the bike is to collection."}
            </p>
          </div>

          <div className="workshop-portal-topbar">
            <Link to={publicSitePaths.repairs}>Repair journey</Link>
            <Link to={publicSitePaths.bookWorkshop}>Book another workshop visit</Link>
            <Link to={publicSitePaths.contact}>Contact the shop</Link>
            <a href="#quote-section">Quote</a>
            <a href="#collection-section">Collection</a>
            <a href="#messages-section">Messages</a>
          </div>

          {loading ? <p>Loading workshop update...</p> : null}

          {!loading && loadError ? (
            <div className="quick-create-panel">
              <strong>Workshop update unavailable</strong>
              <p className="muted-text">{loadError}</p>
              <Link to={publicSitePaths.repairs}>Back to repair information</Link>
            </div>
          ) : null}

          {!loading && !loadError && !token ? (
            <div className="quick-create-panel">
              <strong>No workshop link selected</strong>
              <p className="muted-text">Open the secure workshop link from the shop to review your bike job.</p>
            </div>
          ) : null}

          {!loading && !loadError && payload && actionSummary ? (
            <>
            <div className="workshop-portal-summary-grid">
              <section className="workshop-portal-summary-card workshop-portal-summary-card--highlight">
                <span className="workshop-portal-summary-label">Right now</span>
                <strong className="workshop-portal-summary-value">{payload.customerProgress.headline}</strong>
                <p className="workshop-portal-summary-detail">{payload.customerProgress.nextStep}</p>
              </section>
              <section className="workshop-portal-summary-card">
                <span className="workshop-portal-summary-label">Waiting on</span>
                <strong className="workshop-portal-summary-value">{waitingSummary?.label ?? "Workshop update"}</strong>
                <p className="workshop-portal-summary-detail">{waitingSummary?.detail ?? payload.customerProgress.detail}</p>
              </section>
              <section className="workshop-portal-summary-card" data-testid="workshop-portal-collection-summary">
                <span className="workshop-portal-summary-label">Collection &amp; payment</span>
                <strong className="workshop-portal-summary-value">
                  {payload.collection.totalPence !== null
                    ? payload.collection.outstandingPence && payload.collection.outstandingPence > 0
                      ? `${formatMoney(payload.collection.outstandingPence)} due`
                      : collectionStatusLabel(payload.collection.state)
                    : collectionStatusLabel(payload.collection.state)}
                </strong>
                <p className="workshop-portal-summary-detail">{payload.collection.detail}</p>
              </section>
              <section className="workshop-portal-summary-card">
                <span className="workshop-portal-summary-label">{latestActivity?.label ?? "Latest activity"}</span>
                <strong className="workshop-portal-summary-value">{latestActivity?.value ?? "-"}</strong>
                <p className="workshop-portal-summary-detail">{latestActivity?.detail ?? "No customer-facing update yet."}</p>
              </section>
            </div>

            <section
              className={`workshop-portal-action workshop-portal-action--${actionSummary.tone}`}
              data-testid="workshop-portal-action-summary"
            >
              <div className="workshop-portal-action-copy">
                <span className="workshop-portal-action-eyebrow">{actionSummary.eyebrow}</span>
                <h2 className="workshop-portal-action-title">{actionSummary.title}</h2>
                <p className="workshop-portal-action-detail">{actionSummary.detail}</p>
                <p className="workshop-portal-action-next">{actionSummary.nextStep}</p>
              </div>
              <div className="actions-inline">
                {payload.portal.accessStatus === "ACTIVE" && payload.portal.canApprove ? (
                  <>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void handleDecision("APPROVED")}
                      disabled={submitting !== null}
                      data-testid="workshop-portal-approve"
                    >
                      {submitting === "APPROVED" ? "Approving..." : "Approve quote"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDecision("REJECTED")}
                      disabled={submitting !== null}
                      data-testid="workshop-portal-reject"
                    >
                      {submitting === "REJECTED" ? "Rejecting..." : "Reject quote"}
                    </button>
                  </>
                ) : (
                  <>
                    {actionSummary.primaryLink ? (
                      <a href={actionSummary.primaryLink.href} className="button-link">
                        {actionSummary.primaryLink.label}
                      </a>
                    ) : null}
                    {actionSummary.secondaryLink ? (
                      <a href={actionSummary.secondaryLink.href} className="button-link">
                        {actionSummary.secondaryLink.label}
                      </a>
                    ) : null}
                  </>
                )}
              </div>
            </section>

            <section className="workshop-portal-panel workshop-portal-progress" data-testid="workshop-portal-journey-summary">
              <div className="card-header-row">
                <div>
                  <h2>Journey so far</h2>
                  <p className="table-secondary">
                    A simple view of where the bike is, what still needs to happen, and when collection becomes possible.
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

            {payload.estimateChangeSummary ? (
              <section
                className="workshop-portal-panel"
                id="quote-changes"
                data-testid="workshop-portal-estimate-changes"
              >
                <div className="card-header-row">
                  <div>
                    <h2>What changed in the quote</h2>
                    <p className="table-secondary">
                      Compare the newly saved estimate against the version that was originally shared with you.
                    </p>
                  </div>
                  <span className={workshopQuoteAccessStatusClass(payload.portal.accessStatus)}>
                    {payload.estimateChangeSummary.currentVersion !== null
                      ? `v${payload.estimateChangeSummary.previousVersion} to v${payload.estimateChangeSummary.currentVersion}`
                      : `v${payload.estimateChangeSummary.previousVersion} to live job`}
                  </span>
                </div>
                <div className="workshop-portal-callout">
                  <strong>Total change: {formatSignedMoney(payload.estimateChangeSummary.differencePence)}</strong>
                  <p className="muted-text">
                    Earlier total {formatMoney(payload.estimateChangeSummary.previousSubtotalPence)}. Current total {formatMoney(payload.estimateChangeSummary.currentSubtotalPence)}.
                  </p>
                </div>
                {payload.estimateChangeSummary.changes.length > 0 ? (
                  <div className="workshop-portal-change-list">
                    {payload.estimateChangeSummary.changes.map((change, index) => (
                      <article
                        key={`${change.changeType}-${change.description}-${index}`}
                        className="workshop-portal-change-card"
                      >
                        <div className="note-card-header">
                          <span className={change.changeType === "REMOVED" ? "status-badge status-cancelled" : change.changeType === "UPDATED" ? "status-badge status-warning" : "status-badge status-info"}>
                            {change.changeType === "ADDED"
                              ? "Added"
                              : change.changeType === "REMOVED"
                                ? "Removed"
                                : "Updated"}
                          </span>
                          <span className="workshop-portal-change-amount">{describeEstimateChange(change)}</span>
                        </div>
                        <strong>{change.description}</strong>
                        {change.meta ? <div className="table-secondary">{change.meta}</div> : null}
                        {change.changeType === "UPDATED" ? (
                          <p className="muted-text">
                            Qty {change.previousQty ?? "-"} to {change.currentQty ?? "-"}.
                            {" "}Price {change.previousUnitPricePence !== null ? formatMoney(change.previousUnitPricePence) : "-"}
                            {" "}to {change.currentUnitPricePence !== null ? formatMoney(change.currentUnitPricePence) : "-"}.
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted-text">The workshop saved a new version number, but no customer-visible line changes were recorded.</p>
                )}
              </section>
            ) : null}

            {payload.estimate ? (
              <section className="workshop-portal-panel" id="quote-section">
                <div className="card-header-row">
                  <div>
                    <h2>Current quote</h2>
                    <p className="table-secondary">
                      Version {payload.estimate.version}
                      {payload.estimateChangeSummary
                        ? `, replacing version ${payload.estimateChangeSummary.previousVersion}`
                        : ""}
                    </p>
                  </div>
                  <span className={workshopEstimateStatusClass(payload.estimate.status)}>
                    {workshopEstimateStatusLabel(payload.estimate.status, "customer")}
                  </span>
                </div>

                <p className="workshop-portal-section-lead">
                  {payload.portal.canApprove
                    ? "This is the work the shop is asking you to approve before they continue."
                    : payload.estimate.status === "APPROVED"
                      ? "This is the approved quote the workshop is currently working from."
                      : payload.estimate.status === "REJECTED"
                        ? "This is the quote that was declined."
                        : "This is the current quote on the job."}
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

                <div className="job-meta-grid workshop-portal-key-grid">
                  <div><strong>Quote requested:</strong> {formatOptionalDateTime(payload.estimate.requestedAt)}</div>
                  <div><strong>Secure review link:</strong> {formatOptionalDateTime(payload.portal.customerQuote?.expiresAt)}</div>
                  <div><strong>Approval recorded:</strong> {formatOptionalDateTime(payload.estimate.approvedAt)}</div>
                  <div><strong>Rejected recorded:</strong> {formatOptionalDateTime(payload.estimate.rejectedAt)}</div>
                </div>

                {payload.portal.canApprove ? (
                  <div className="workshop-portal-change-list">
                    <article className="workshop-portal-change-card">
                      <div className="note-card-header">
                        <span className="status-badge status-complete">If you approve</span>
                      </div>
                      <strong>The workshop can continue</strong>
                      <p className="muted-text">Approval feeds straight into the live job so the team can keep working without waiting for another call.</p>
                    </article>
                    <article className="workshop-portal-change-card">
                      <div className="note-card-header">
                        <span className="status-badge status-cancelled">If you reject</span>
                      </div>
                      <strong>The job pauses for follow-up</strong>
                      <p className="muted-text">Rejecting tells the workshop not to continue this quote until they speak with you again.</p>
                    </article>
                  </div>
                ) : null}

                {estimateLines.length > 0 ? (
                  <div className="table-wrap">
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
                  <p className="muted-text">No quoted lines have been saved for this job yet.</p>
                )}
              </section>
            ) : null}

            <section className="workshop-portal-panel workshop-portal-panel--accent" id="collection-section">
              <div className="card-header-row">
                <div>
                  <h2>Collection and payment</h2>
                  <p className="table-secondary">
                    The clearest view of whether the bike is ready, whether anything is left to pay, and what happens next.
                  </p>
                </div>
                <span className={collectionStatusClass(payload.collection.state)}>
                  {collectionStatusLabel(payload.collection.state)}
                </span>
              </div>

              <p className="workshop-portal-section-lead">{payload.collection.headline}</p>
              <p className="muted-text">{payload.collection.detail}</p>

              <div className="metric-grid">
                <div className="metric-card">
                  <span className="metric-label">Final total</span>
                  <strong className="metric-value">
                    {payload.collection.totalPence !== null ? formatMoney(payload.collection.totalPence) : "TBC"}
                  </strong>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Paid so far</span>
                  <strong className="metric-value">{formatMoney(payload.collection.paidPence)}</strong>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Still to pay</span>
                  <strong className="metric-value">
                    {payload.collection.outstandingPence !== null
                      ? formatMoney(payload.collection.outstandingPence)
                      : "TBC"}
                  </strong>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Deposit</span>
                  <strong className="metric-value">
                    {payload.collection.depositRequiredPence > 0
                      ? `${formatMoney(payload.collection.depositRequiredPence)} / ${payload.collection.depositStatus === "PAID" ? "paid" : "not yet paid"}`
                      : "No deposit"}
                  </strong>
                </div>
              </div>

              <div className="workshop-portal-callout">
                <strong>Next step</strong>
                <p className="muted-text">{payload.collection.nextStep}</p>
              </div>
            </section>

            {!workSummaryMatchesEstimate ? (
              <section className="workshop-portal-panel">
                <div className="card-header-row">
                  <div>
                    <h2>Latest recorded work summary</h2>
                    <p className="table-secondary">
                      This is the live labour and parts list on the job right now.
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
                  <div className="table-wrap">
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
                  <p className="muted-text">The workshop has not added any labour or parts lines yet.</p>
                )}
              </section>
            ) : (
              <div className="workshop-portal-inline-note">
                <strong>Current recorded work still matches the quote above.</strong>
                <p className="muted-text">There is no separate live-work difference to review right now.</p>
              </div>
            )}

            <section className="workshop-portal-panel" id="messages-section">
              <div className="card-header-row">
                <div>
                  <h2>Message thread</h2>
                  <p className="table-secondary">
                    Use this thread for questions, updates, and anything the workshop still needs from you.
                  </p>
                </div>
                <span className="table-secondary">
                  {conversationPayload?.conversation.messageCount ?? 0} message
                  {(conversationPayload?.conversation.messageCount ?? 0) === 1 ? "" : "s"}
                </span>
              </div>

              <div className="workshop-portal-message-summary">
                <article className="workshop-portal-message-summary-card">
                  <span className="workshop-portal-summary-label">Latest contact</span>
                  <strong>{latestActivity?.value ?? "-"}</strong>
                  <p>{latestActivity?.detail ?? "No customer-facing message yet."}</p>
                </article>
                <article className="workshop-portal-message-summary-card">
                  <span className="workshop-portal-summary-label">Replies available</span>
                  <strong>{conversationPayload?.conversation.canReply ? "Yes" : "Read only"}</strong>
                  <p>
                    {conversationPayload?.conversation.canReply
                      ? "Reply here if you need to confirm timing, ask a question, or explain your decision."
                      : "This secure reply link is no longer active, but the conversation history stays visible."}
                  </p>
                </article>
                <article className="workshop-portal-message-summary-card">
                  <span className="workshop-portal-summary-label">Best use of this thread</span>
                  <strong>{payload.portal.canApprove ? "Questions before approval" : "Timing and collection updates"}</strong>
                  <p>
                    {payload.portal.canApprove
                      ? "If anything in the quote is unclear, send the workshop a message before you decide."
                      : "Use this thread for practical updates rather than long internal workshop notes."}
                  </p>
                </article>
              </div>

              {conversationLoading ? <p>Loading conversation...</p> : null}
              {!conversationLoading && conversationError ? (
                <p className="muted-text">{conversationError}</p>
              ) : null}

              {!conversationLoading && !conversationError && conversationMessages.length === 0 ? (
                <p className="muted-text">The workshop has not added any direct messages yet.</p>
              ) : (
                <div className="conversation-thread conversation-thread--portal">
                  {conversationMessages.map((message) => {
                    const messageTimestamp = message.sentAt ?? message.receivedAt ?? message.createdAt;
                    const isLatest = latestMessage?.id === message.id;
                    return (
                      <article
                        key={message.id}
                        className={`conversation-message-card conversation-message-card--${
                          message.direction === "OUTBOUND" ? "outbound" : "inbound"
                        }`}
                      >
                        <div className="note-card-header">
                          <div className="actions-inline">
                            <span
                              className={
                                message.direction === "OUTBOUND"
                                  ? "status-badge status-info"
                                  : "status-badge status-complete"
                              }
                            >
                              {message.direction === "OUTBOUND" ? "Workshop update" : "Your reply"}
                            </span>
                            {isLatest ? <span className="status-badge">Latest</span> : null}
                          </div>
                          <span className="table-secondary">{formatOptionalDateTime(messageTimestamp)}</span>
                        </div>
                        <p>{message.body}</p>
                        <div className="table-secondary">{message.senderLabel}</div>
                      </article>
                    );
                  })}
                </div>
              )}

              <div className="note-form-grid">
                <label className="note-form-wide">
                  Reply to the workshop
                  <textarea
                    value={replyDraft}
                    onChange={(event) => setReplyDraft(event.target.value)}
                    placeholder="Ask a question or send an update to the workshop team"
                    disabled={!conversationPayload?.conversation.canReply}
                  />
                </label>
                <div className="actions-inline">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void handleReply()}
                    disabled={
                      replying
                      || !replyDraft.trim()
                      || !conversationPayload?.conversation.canReply
                    }
                  >
                    {replying ? "Sending..." : "Send message"}
                  </button>
                </div>
              </div>
            </section>

            <section className="workshop-portal-panel">
              <div className="card-header-row">
                <div>
                  <h2>Shared photos and files</h2>
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
                <div className="card-header-row">
                  <div>
                    <h2>Booking and workshop details</h2>
                    <p className="table-secondary">
                      The core customer-facing details the workshop has linked to this job.
                    </p>
                  </div>
                  <span className="table-secondary">{payload.job.statusLabel}</span>
                </div>
                <div className="job-meta-grid workshop-portal-key-grid">
                  <div><strong>Bike:</strong> {payload.bike.displayName}</div>
                  <div><strong>Booked:</strong> {formatOptionalDateTime(payload.job.createdAt)}</div>
                  <div><strong>Scheduled:</strong> {formatScheduledWindow(payload.job)}</div>
                  <div><strong>Latest update:</strong> {formatOptionalDateTime(payload.job.updatedAt)}</div>
                  <div><strong>Workshop slot:</strong> {payload.job.durationMinutes ? `${payload.job.durationMinutes} minutes` : "To be confirmed"}</div>
                  <div><strong>Secure review link:</strong> {formatOptionalDateTime(payload.portal.customerQuote?.expiresAt)}</div>
                </div>
              </section>

              <section className="workshop-portal-panel">
                <div className="card-header-row">
                  <div>
                    <h2>Bike profile</h2>
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
    </PublicSiteLayout>
  );
};
