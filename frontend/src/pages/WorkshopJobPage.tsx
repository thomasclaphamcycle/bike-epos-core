import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import { WorkshopServiceTemplatePreview } from "../components/WorkshopServiceTemplatePreview";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { useOpenPosWithContext, type PosLineItem, type SaleContext } from "../features/pos/posContext";
import {
  getWorkshopDisplayStatus,
  getWorkshopRawStatusValue,
  getWorkshopTechnicianWorkflowSummary,
  getWorkshopStatusTimeline,
  workshopRawStatusActionClass,
  workshopRawStatusClass,
  workshopRawStatusLabel,
  workshopTechnicianWorkflowClass,
  workshopTechnicianWorkflowLabel,
  workshopStatusSelectorOptions,
} from "../features/workshop/status";
import {
  workshopCustomerQuoteLinkStatusLabel,
  workshopEstimateStatusClass,
  workshopEstimateStatusLabel,
} from "../features/workshop/estimateStatus";
import {
  workshopNotificationChannelLabel,
  workshopNotificationDeliveryStatusClass,
  workshopNotificationDeliveryStatusLabel,
  workshopNotificationEventLabel,
  workshopNotificationStrategyLabel,
} from "../features/workshop/notificationStatus";
import {
  formatWorkshopTemplateMoney,
  getDefaultSelectedOptionalLineIds,
  type WorkshopServiceTemplateApplyResponse,
  type WorkshopServiceTemplate,
  type WorkshopServiceTemplatesResponse,
} from "../features/workshop/serviceTemplates";
import { toBackendUrl } from "../utils/backendUrl";
import { useAuth } from "../auth/AuthContext";

type WorkshopLine = {
  id: string;
  type: "LABOUR" | "PART";
  productId: string | null;
  productName: string | null;
  variantId: string | null;
  variantSku: string | null;
  variantName: string | null;
  description: string;
  qty: number;
  unitPricePence: number;
  lineTotalPence: number;
};

type WorkshopPartsStatus = "OK" | "UNALLOCATED" | "SHORT";

type JobPartRequirement = {
  variantId: string;
  sku: string;
  variantName: string | null;
  productId: string;
  productName: string;
  requiredQty: number;
  allocatedQty: number;
  consumedQty: number;
  returnedQty: number;
  outstandingQty: number;
  availableToAllocate: number;
  missingQty: number;
  stockOnHand: number;
  estimateValuePence: number;
  partsStatus: WorkshopPartsStatus;
};

type PartsOverview = {
  stockLocation: {
    id: string;
    name: string;
    isDefault: boolean;
    source: string;
  };
  requirements: JobPartRequirement[];
  summary: {
    requiredQty: number;
    allocatedQty: number;
    consumedQty: number;
    returnedQty: number;
    outstandingQty: number;
    missingQty: number;
    partsStatus: WorkshopPartsStatus;
  };
};

type WorkshopPartRecord = {
  id: string;
  workshopJobId: string;
  variantId: string;
  stockLocationId: string;
  stockLocationName: string;
  sku: string;
  variantName: string | null;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceAtTime: number;
  costPriceAtTime: number | null;
  lineTotalPence: number;
  status: "PLANNED" | "USED" | "RETURNED";
  createdAt: string;
  updatedAt: string;
};

type WorkshopPartsResponse = PartsOverview & {
  workshopJobId: string;
  parts: WorkshopPartRecord[];
  totals: {
    partsUsedTotalPence: number;
    partsPlannedTotalPence: number;
    partsReturnedTotalPence: number;
  };
};

type CustomerBikeRecord = {
  id: string;
  customerId: string;
  label: string | null;
  make: string | null;
  model: string | null;
  colour: string | null;
  frameNumber: string | null;
  serialNumber: string | null;
  registrationNumber: string | null;
  notes: string | null;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

type CustomerBikesResponse = {
  customerId: string;
  bikes: CustomerBikeRecord[];
};

type WorkshopEstimateRecord = {
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
  customerQuote: {
    publicPath: string;
    expiresAt: string;
    status: "ACTIVE" | "EXPIRED";
  } | null;
  createdByStaff: {
    id: string;
    username: string;
    name: string | null;
  } | null;
  decisionByStaff: {
    id: string;
    username: string;
    name: string | null;
  } | null;
};

type WorkshopJobResponse = {
  job: {
    id: string;
    status: string;
    rawStatus?: string | null;
    customerId: string | null;
    customerName: string | null;
    bikeId: string | null;
    bikeDescription: string | null;
    bike: CustomerBikeRecord | null;
    notes: string | null;
    assignedStaffId: string | null;
    assignedStaffName: string | null;
    scheduledDate: string | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    durationMinutes: number | null;
    depositRequiredPence: number;
    depositStatus: string;
    finalizedBasketId: string | null;
    sale: {
      id: string;
      totalPence: number;
      createdAt: string;
    } | null;
    completedAt: string | null;
    closedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  lines: WorkshopLine[];
  partsOverview: PartsOverview;
  currentEstimate: WorkshopEstimateRecord | null;
  estimateHistory: WorkshopEstimateRecord[];
  hasApprovedEstimate: boolean;
};

type WorkshopNote = {
  id: string;
  workshopJobId: string;
  authorStaffId: string | null;
  visibility: "INTERNAL" | "CUSTOMER";
  note: string;
  createdAt: string;
  authorStaff: {
    id: string;
    username: string;
    name: string | null;
  } | null;
};

type WorkshopNotesResponse = {
  notes: WorkshopNote[];
};

type WorkshopConversationMessage = {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  channel: "PORTAL" | "EMAIL" | "SMS" | "WHATSAPP" | "INTERNAL_SYSTEM";
  customerVisible: boolean;
  body: string;
  deliveryStatus: "PENDING" | "SENT" | "RECEIVED" | "FAILED" | null;
  sentAt: string | null;
  receivedAt: string | null;
  externalMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  authorStaff: {
    id: string;
    username: string;
    name: string | null;
  } | null;
};

type WorkshopConversationResponse = {
  conversation: {
    id: string;
    workshopJobId: string;
    customerId: string | null;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    lastMessageAt: string | null;
    portalAccess: {
      accessStatus: "ACTIVE" | "EXPIRED" | "SUPERSEDED" | "UNAVAILABLE";
      publicPath: string | null;
      expiresAt: string | null;
      linkedEstimateVersion: number | null;
      currentEstimateVersion: number | null;
      hasUpdatedEstimate: boolean;
      canCustomerReply: boolean;
    };
  };
  messages: WorkshopConversationMessage[];
};

type WorkshopTimelineEvent = {
  id: string;
  occurredAt: string;
  label: string;
  description: string;
};

type WorkshopTimelineResponse = {
  entityType: "WORKSHOP_JOB";
  entityId: string;
  events: WorkshopTimelineEvent[];
};

type WorkshopAttachmentRecord = {
  id: string;
  workshopJobId: string;
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
  visibility: "INTERNAL" | "CUSTOMER";
  createdAt: string;
  updatedAt: string;
  isImage: boolean;
  filePath: string;
  uploadedByStaff: {
    id: string;
    username: string;
    name: string | null;
  } | null;
};

type WorkshopAttachmentsResponse = {
  workshopJobId: string;
  attachments: WorkshopAttachmentRecord[];
};

type WorkshopNotificationRecord = {
  id: string;
  workshopJobId: string;
  workshopEstimateId: string | null;
  channel: "EMAIL" | "SMS" | "WHATSAPP";
  eventType: "QUOTE_READY" | "JOB_READY_FOR_COLLECTION" | "PORTAL_MESSAGE";
  deliveryStatus: "PENDING" | "SENT" | "SKIPPED" | "FAILED";
  recipientEmail: string | null;
  recipientPhone: string | null;
  subject: string | null;
  messageSummary: string | null;
  reasonCode: string | null;
  reasonMessage: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  strategy: {
    mode: "AUTOMATED" | "MANUAL_RESEND";
    priorityRank: number | null;
    priorityType: "PRIMARY" | "FALLBACK" | null;
    label: string | null;
  } | null;
};

type WorkshopNotificationsResponse = {
  workshopJobId: string;
  notifications: WorkshopNotificationRecord[];
};

type ProductSearchRow = {
  id: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  pricePence: number;
};

type EditableLine = {
  description: string;
  qty: number;
  unitPricePence: number;
};

type WorkshopJobSignal = {
  label: string;
  detail: string;
  className: string;
};

type WorkshopJobNextAction =
  | {
      title: string;
      detail: string;
      highlights: string[];
      actionKind: "saveEstimate" | "prepareQuote" | "moveToBench" | "openPosHandoff" | "jumpToBuild" | "jumpToParts";
      actionLabel: string;
    }
  | {
      title: string;
      detail: string;
      highlights: string[];
      actionKind: null;
      actionLabel: null;
    };

type WorkshopJobActivityHighlight = {
  label: string;
  detail: string;
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

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to read attachment file"));
    };
    reader.onerror = () => reject(new Error("Failed to read attachment file"));
    reader.readAsDataURL(file);
  });

const getPublicAppOrigin = () => {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
};

const toPublicAppUrl = (path: string) => {
  const origin = getPublicAppOrigin();
  return origin ? `${origin}${path.startsWith("/") ? path : `/${path}`}` : path;
};

const isManagerPlus = (role: string | undefined) => role === "MANAGER" || role === "ADMIN";

const estimateDecisionSourceLabel = (
  source: WorkshopEstimateRecord["decisionSource"] | null | undefined,
) => {
  if (source === "CUSTOMER") {
    return "Customer";
  }
  if (source === "STAFF") {
    return "Staff";
  }
  return "-";
};

const partsStatusClass = (status: WorkshopPartsStatus | undefined) => {
  if (status === "SHORT") {
    return "status-badge status-warning";
  }
  if (status === "UNALLOCATED") {
    return "status-badge";
  }
  return "status-badge status-complete";
};

const truncateText = (value: string, limit = 96) =>
  value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}...` : value;

const formatOptionalDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "-";

const timestampValue = (value: string | null | undefined) => {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
};

const getMostRecentEntry = <T,>(
  items: T[],
  getValue: (item: T) => string | null | undefined,
) =>
  [...items].sort((left, right) => timestampValue(getValue(right)) - timestampValue(getValue(left)))[0] ?? null;

const notificationActionLabel = (
  eventType: WorkshopNotificationRecord["eventType"],
) =>
  eventType === "QUOTE_READY"
    ? "quote email"
    : eventType === "JOB_READY_FOR_COLLECTION"
      ? "ready-for-collection email"
      : "portal message alert";

const notificationRecipientLabel = (notification: WorkshopNotificationRecord) =>
  notification.channel === "EMAIL"
    ? notification.recipientEmail || "No customer email"
    : notification.recipientPhone || "No customer phone";

const notificationChannelSummaryLabel = (notification: WorkshopNotificationRecord) =>
  [workshopNotificationChannelLabel(notification.channel), workshopNotificationStrategyLabel(notification.strategy)]
    .filter(Boolean)
    .join(" • ");

const canPersistApprovalStatus = (status: string | null | undefined) =>
  ["BOOKED", "BIKE_ARRIVED", "APPROVED", "WAITING_FOR_APPROVAL", "ON_HOLD"].includes(
    getWorkshopDisplayStatus(status) ?? "",
  );

const formatWorkshopDepositState = (
  depositStatus: string | null | undefined,
  depositRequiredPence: number,
) => {
  if (!depositRequiredPence || depositStatus === "NOT_REQUIRED") {
    return "No deposit required";
  }

  if (depositStatus === "PAID") {
    return `Deposit paid (${formatMoney(depositRequiredPence)})`;
  }

  return `Deposit outstanding (${formatMoney(depositRequiredPence)})`;
};

export const WorkshopJobPage = () => {
  const { id } = useParams<{ id: string }>();
  const openPosWithContext = useOpenPosWithContext();
  const { user } = useAuth();
  const { success, error } = useToasts();

  const [payload, setPayload] = useState<WorkshopJobResponse | null>(null);
  const [notes, setNotes] = useState<WorkshopNote[]>([]);
  const [conversationPayload, setConversationPayload] = useState<WorkshopConversationResponse | null>(null);
  const [attachmentsPayload, setAttachmentsPayload] = useState<WorkshopAttachmentsResponse | null>(null);
  const [notifications, setNotifications] = useState<WorkshopNotificationRecord[]>([]);
  const [partsPayload, setPartsPayload] = useState<WorkshopPartsResponse | null>(null);
  const [timelinePayload, setTimelinePayload] = useState<WorkshopTimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [partsLoading, setPartsLoading] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [customerBikes, setCustomerBikes] = useState<CustomerBikeRecord[]>([]);
  const [customerBikesLoading, setCustomerBikesLoading] = useState(false);

  const [editableByLineId, setEditableByLineId] = useState<Record<string, EditableLine>>({});

  const [labourDescription, setLabourDescription] = useState("General labour");
  const [labourQty, setLabourQty] = useState(1);
  const [labourPrice, setLabourPrice] = useState(2500);

  const [partSearch, setPartSearch] = useState("");
  const [partQty, setPartQty] = useState(1);
  const [partPrice, setPartPrice] = useState(0);
  const debouncedPartSearch = useDebouncedValue(partSearch, 250);
  const [partResults, setPartResults] = useState<ProductSearchRow[]>([]);

  const [noteDraft, setNoteDraft] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<"INTERNAL" | "CUSTOMER">("INTERNAL");
  const [savingNote, setSavingNote] = useState(false);
  const [conversationDraft, setConversationDraft] = useState("");
  const [sendingConversation, setSendingConversation] = useState(false);
  const [selectedAttachmentFile, setSelectedAttachmentFile] = useState<File | null>(null);
  const [attachmentVisibility, setAttachmentVisibility] =
    useState<WorkshopAttachmentRecord["visibility"]>("INTERNAL");
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);
  const [selectedBikeId, setSelectedBikeId] = useState("");
  const [bikeDescriptionDraft, setBikeDescriptionDraft] = useState("");
  const [createBikeInline, setCreateBikeInline] = useState(false);
  const [bikeLabelDraft, setBikeLabelDraft] = useState("");
  const [bikeMakeDraft, setBikeMakeDraft] = useState("");
  const [bikeModelDraft, setBikeModelDraft] = useState("");
  const [bikeColourDraft, setBikeColourDraft] = useState("");
  const [bikeFrameDraft, setBikeFrameDraft] = useState("");
  const [bikeSerialDraft, setBikeSerialDraft] = useState("");
  const [bikeRegistrationDraft, setBikeRegistrationDraft] = useState("");
  const [bikeNotesDraft, setBikeNotesDraft] = useState("");
  const [savingBikeLink, setSavingBikeLink] = useState(false);
  const [savingEstimate, setSavingEstimate] = useState(false);
  const [preparingCustomerQuote, setPreparingCustomerQuote] = useState(false);
  const [resendingNotificationType, setResendingNotificationType] = useState<
    WorkshopNotificationRecord["eventType"] | null
  >(null);
  const [templates, setTemplates] = useState<WorkshopServiceTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedOptionalTemplateLineIds, setSelectedOptionalTemplateLineIds] = useState<string[]>([]);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [statusPanelTab, setStatusPanelTab] = useState<"progress" | "timeline">("progress");
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);

  const canPostCustomerNotes = isManagerPlus(user?.role);

  const loadJob = async () => {
    if (!id) {
      return;
    }

    setLoading(true);
    try {
      const response = await apiGet<WorkshopJobResponse>(`/api/workshop/jobs/${encodeURIComponent(id)}`);
      setPayload(response);
      setEditableByLineId(
        Object.fromEntries(
          response.lines.map((line) => [
            line.id,
            {
              description: line.description,
              qty: line.qty,
              unitPricePence: line.unitPricePence,
            },
          ]),
        ),
      );
      setSelectedBikeId(response.job.bike?.id ?? "");
      setBikeDescriptionDraft(response.job.bikeDescription ?? "");
      setCreateBikeInline(false);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load workshop job";
      error(message);
    } finally {
      setLoading(false);
    }
  };

  const loadCustomerBikes = async (customerId: string) => {
    setCustomerBikesLoading(true);
    try {
      const response = await apiGet<CustomerBikesResponse>(`/api/customers/${encodeURIComponent(customerId)}/bikes`);
      setCustomerBikes(response.bikes || []);
    } catch (loadError) {
      setCustomerBikes([]);
      const message = loadError instanceof Error ? loadError.message : "Failed to load customer bikes";
      error(message);
    } finally {
      setCustomerBikesLoading(false);
    }
  };

  const loadNotes = async () => {
    if (!id) {
      return;
    }

    setNotesLoading(true);
    try {
      const response = await apiGet<WorkshopNotesResponse>(`/api/workshop/jobs/${encodeURIComponent(id)}/notes`);
      setNotes(response.notes || []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load workshop notes";
      error(message);
    } finally {
      setNotesLoading(false);
    }
  };

  const loadConversation = async () => {
    if (!id) {
      return;
    }

    setConversationLoading(true);
    try {
      const response = await apiGet<WorkshopConversationResponse>(
        `/api/workshop/jobs/${encodeURIComponent(id)}/conversation`,
      );
      setConversationPayload(response);
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Failed to load workshop conversation";
      error(message);
    } finally {
      setConversationLoading(false);
    }
  };

  const loadAttachments = async () => {
    if (!id) {
      return;
    }

    setAttachmentsLoading(true);
    try {
      const response = await apiGet<WorkshopAttachmentsResponse>(
        `/api/workshop/jobs/${encodeURIComponent(id)}/attachments`,
      );
      setAttachmentsPayload(response);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "Failed to load workshop attachments";
      error(message);
    } finally {
      setAttachmentsLoading(false);
    }
  };

  const loadNotifications = async () => {
    if (!id) {
      return;
    }

    setNotificationsLoading(true);
    try {
      const response = await apiGet<WorkshopNotificationsResponse>(
        `/api/workshop/jobs/${encodeURIComponent(id)}/notifications`,
      );
      setNotifications(response.notifications || []);
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Failed to load workshop notifications";
      error(message);
    } finally {
      setNotificationsLoading(false);
    }
  };

  const loadParts = async () => {
    if (!id) {
      return;
    }

    setPartsLoading(true);
    try {
      const response = await apiGet<WorkshopPartsResponse>(`/api/workshop-jobs/${encodeURIComponent(id)}/parts`);
      setPartsPayload(response);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load workshop parts";
      error(message);
    } finally {
      setPartsLoading(false);
    }
  };

  const loadTimeline = async () => {
    if (!id) {
      return;
    }

    setTimelineLoading(true);
    try {
      const response = await apiGet<WorkshopTimelineResponse>(
        `/api/events?entityType=WORKSHOP_JOB&entityId=${encodeURIComponent(id)}`,
      );
      setTimelinePayload(response);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load workshop timeline";
      error(message);
    } finally {
      setTimelineLoading(false);
    }
  };

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const response = await apiGet<WorkshopServiceTemplatesResponse>("/api/workshop/service-templates");
      setTemplates(response.templates || []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load workshop templates";
      error(message);
    } finally {
      setLoadingTemplates(false);
    }
  };

  useEffect(() => {
    void Promise.all([
      loadJob(),
      loadNotes(),
      loadConversation(),
      loadAttachments(),
      loadNotifications(),
      loadParts(),
      loadTimeline(),
      loadTemplates(),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const customerId = payload?.job.customerId;
    if (!customerId) {
      setCustomerBikes([]);
      setSelectedBikeId("");
      setCreateBikeInline(false);
      return;
    }

    void loadCustomerBikes(customerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload?.job.customerId]);

  useEffect(() => {
    if (!statusMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && statusMenuRef.current?.contains(target)) {
        return;
      }
      setStatusMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setStatusMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [statusMenuOpen]);

  useEffect(() => {
    if (!debouncedPartSearch.trim()) {
      setPartResults([]);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const results = await apiGet<{ rows: ProductSearchRow[] }>(
          `/api/products/search?q=${encodeURIComponent(debouncedPartSearch.trim())}`,
        );
        if (!cancelled) {
          setPartResults(Array.isArray(results.rows) ? results.rows : []);
        }
      } catch (searchError) {
        if (!cancelled) {
          const message = searchError instanceof Error ? searchError.message : "Product search failed";
          error(message);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [debouncedPartSearch, error]);

  const updateStageStatus = async (nextStatus: string) => {
    if (!id || updatingStatus) {
      return;
    }

    setUpdatingStatus(true);
    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(id)}/status`, { status: nextStatus });
      setStatusMenuOpen(false);
      success(`Status updated to ${workshopRawStatusLabel(nextStatus)}`);
      await Promise.all([loadJob(), loadNotifications()]);
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : "Failed to update status";
      error(message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const uploadAttachment = async () => {
    if (!id || !selectedAttachmentFile || uploadingAttachment) {
      return;
    }

    setUploadingAttachment(true);
    try {
      const fileDataUrl = await readFileAsDataUrl(selectedAttachmentFile);
      await apiPost<{ attachment: WorkshopAttachmentRecord }>(
        `/api/workshop/jobs/${encodeURIComponent(id)}/attachments`,
        {
          filename: selectedAttachmentFile.name,
          fileDataUrl,
          visibility: attachmentVisibility,
        },
      );
      success(
        attachmentVisibility === "CUSTOMER"
          ? "Attachment uploaded and shared with the customer portal"
          : "Internal attachment uploaded",
      );
      setSelectedAttachmentFile(null);
      await loadAttachments();
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Failed to upload attachment";
      error(message);
    } finally {
      setUploadingAttachment(false);
    }
  };

  const deleteAttachment = async (attachmentId: string) => {
    if (!id) {
      return;
    }

    setDeletingAttachmentId(attachmentId);
    try {
      await apiDelete(`/api/workshop/jobs/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`);
      success("Attachment deleted");
      await loadAttachments();
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "Failed to delete attachment";
      error(message);
    } finally {
      setDeletingAttachmentId(null);
    }
  };

  const saveEstimateSnapshot = async () => {
    if (!id) {
      return;
    }

    setSavingEstimate(true);
    try {
      const response = await apiPost<{ idempotent: boolean }>(`/api/workshop/jobs/${encodeURIComponent(id)}/estimate`, {});
      success(response.idempotent ? "Current estimate snapshot already matches the live lines" : "Estimate snapshot saved");
      await loadJob();
    } catch (estimateError) {
      const message = estimateError instanceof Error ? estimateError.message : "Failed to save estimate";
      error(message);
    } finally {
      setSavingEstimate(false);
    }
  };

  const updateApprovalStatus = async (
    nextStatus: "WAITING_FOR_APPROVAL" | "APPROVED" | "REJECTED",
  ) => {
    if (!id) {
      return;
    }

    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(id)}/approval`, { status: nextStatus });
      success(
        nextStatus === "APPROVED"
          ? "Quote marked approved"
          : nextStatus === "REJECTED"
            ? "Quote marked rejected"
            : "Quote marked pending approval",
      );
      await Promise.all([loadJob(), loadNotifications()]);
    } catch (approvalError) {
      const message = approvalError instanceof Error ? approvalError.message : "Failed to update approval state";
      error(message);
    }
  };

  const prepareCustomerQuoteLink = async () => {
    if (!id || !payload || payload.lines.length === 0) {
      return;
    }

    setPreparingCustomerQuote(true);
    try {
      let estimateStatus = payload.currentEstimate?.status ?? null;

      if (!payload.currentEstimate) {
        await apiPost(`/api/workshop/jobs/${encodeURIComponent(id)}/estimate`, {});
        estimateStatus = "DRAFT";
      }

      if (estimateStatus === "DRAFT" || estimateStatus === "REJECTED") {
        await apiPost(`/api/workshop/jobs/${encodeURIComponent(id)}/approval`, {
          status: "WAITING_FOR_APPROVAL",
        });
      }

      const response = await apiPost<{
        idempotent: boolean;
        customerQuote: {
          publicPath: string;
          expiresAt: string;
          status: "ACTIVE" | "EXPIRED";
        } | null;
      }>(`/api/workshop/jobs/${encodeURIComponent(id)}/customer-quote-link`, {});

      const publicPath = response.customerQuote?.publicPath;
      if (!publicPath) {
        throw new Error("Customer portal link was not returned.");
      }

      const publicUrl = toPublicAppUrl(publicPath);
      await navigator.clipboard.writeText(publicUrl);
      success(
        response.idempotent
          ? "Customer portal link copied"
          : "Customer portal link prepared and copied",
      );
      await Promise.all([loadJob(), loadNotifications()]);
    } catch (quoteError) {
      const message = quoteError instanceof Error ? quoteError.message : "Failed to prepare customer portal link";
      error(message);
    } finally {
      setPreparingCustomerQuote(false);
    }
  };

  const resendNotification = async (
    eventType: WorkshopNotificationRecord["eventType"],
  ) => {
    if (!id) {
      return;
    }

    setResendingNotificationType(eventType);
    try {
      const response = await apiPost<{
        notification: WorkshopNotificationRecord;
        attempt: {
          idempotent: boolean;
          deliveryStatus: WorkshopNotificationRecord["deliveryStatus"];
        };
      }>(`/api/workshop/jobs/${encodeURIComponent(id)}/notifications/resend`, {
        eventType,
      });

      const actionLabel = notificationActionLabel(eventType);
      const reasonMessage =
        response.notification.reasonMessage ||
        "The current job state prevented this email from being sent.";

      if (response.notification.deliveryStatus === "SENT") {
        success(
          eventType === "QUOTE_READY"
            ? "Quote email sent again"
            : "Ready-for-collection email sent again",
        );
      } else if (response.notification.deliveryStatus === "SKIPPED") {
        error(`The ${actionLabel} was skipped. ${reasonMessage}`);
      } else if (response.notification.deliveryStatus === "FAILED") {
        error(`The ${actionLabel} failed to send. ${reasonMessage}`);
      } else {
        success(`The ${actionLabel} is being sent.`);
      }

      await loadNotifications();
    } catch (resendError) {
      const message =
        resendError instanceof Error
          ? resendError.message
          : "Failed to resend workshop notification";
      error(message);
    } finally {
      setResendingNotificationType(null);
    }
  };

  const sendConversationMessage = async () => {
    if (!id) {
      return;
    }

    setSendingConversation(true);
    try {
      const response = await apiPost<WorkshopConversationResponse>(
        `/api/workshop/jobs/${encodeURIComponent(id)}/conversation/messages`,
        {
          body: conversationDraft,
        },
      );
      setConversationPayload(response);
      setConversationDraft("");

      const portalReady = Boolean(response.conversation.portalAccess.publicPath);
      success(
        portalReady
          ? "Customer message added to the portal thread"
          : "Customer message saved. Prepare a customer portal link before expecting a reply.",
      );

      setTimeout(() => {
        void loadNotifications();
      }, 300);
    } catch (sendError) {
      const message =
        sendError instanceof Error
          ? sendError.message
          : "Failed to send workshop customer message";
      error(message);
    } finally {
      setSendingConversation(false);
    }
  };

  const applyTemplate = async () => {
    if (!id || !selectedTemplateId) {
      return;
    }

    setApplyingTemplate(true);
    try {
      const response = await apiPost<WorkshopServiceTemplateApplyResponse>(
        `/api/workshop/jobs/${encodeURIComponent(id)}/templates/apply`,
        {
          templateId: selectedTemplateId,
          selectedOptionalLineIds: selectedOptionalTemplateLineIds,
        },
      );
      success(
        response.pricingEffect.fixedPriceActivated
          ? `Fixed-price service template applied and labour will rebalance to ${formatWorkshopTemplateMoney(response.pricingEffect.targetTotalPricePence ?? 0)}`
          : response.durationEffect.durationUpdated
            ? `Workshop service template applied and planning duration set to ${response.durationEffect.appliedDurationMinutes} min`
            : "Workshop service template applied",
      );
      setSelectedTemplateId("");
      await Promise.all([loadJob(), loadParts()]);
    } catch (templateError) {
      const message = templateError instanceof Error ? templateError.message : "Failed to apply workshop template";
      error(message);
    } finally {
      setApplyingTemplate(false);
    }
  };

  const saveBikeRecordLink = async () => {
    if (!id || !payload) {
      return;
    }

    if (!bikeDescriptionDraft.trim()) {
      error("Bike summary is required for the workshop job.");
      return;
    }

    setSavingBikeLink(true);
    try {
      let bikeId: string | null = createBikeInline ? null : selectedBikeId || null;

      if (payload.job.customerId && createBikeInline) {
        const created = await apiPost<{ bike: CustomerBikeRecord }>(
          `/api/customers/${encodeURIComponent(payload.job.customerId)}/bikes`,
          {
            label: bikeLabelDraft || undefined,
            make: bikeMakeDraft || undefined,
            model: bikeModelDraft || undefined,
            colour: bikeColourDraft || undefined,
            frameNumber: bikeFrameDraft || undefined,
            serialNumber: bikeSerialDraft || undefined,
            registrationNumber: bikeRegistrationDraft || undefined,
            notes: bikeNotesDraft || undefined,
          },
        );
        bikeId = created.bike.id;
      }

      await apiPatch(`/api/workshop/jobs/${encodeURIComponent(id)}`, {
        bikeId,
        bikeDescription: bikeDescriptionDraft.trim(),
      });

      setBikeLabelDraft("");
      setBikeMakeDraft("");
      setBikeModelDraft("");
      setBikeColourDraft("");
      setBikeFrameDraft("");
      setBikeSerialDraft("");
      setBikeRegistrationDraft("");
      setBikeNotesDraft("");
      setCreateBikeInline(false);
      success("Workshop bike details updated");
      await loadJob();
    } catch (bikeError) {
      const message = bikeError instanceof Error ? bikeError.message : "Failed to update bike details";
      error(message);
    } finally {
      setSavingBikeLink(false);
    }
  };

  const addLabourLine = async () => {
    if (!id) {
      return;
    }

    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(id)}/lines`, {
        type: "LABOUR",
        description: labourDescription,
        qty: labourQty,
        unitPricePence: labourPrice,
      });
      success("Labour line added");
      await Promise.all([loadJob(), loadParts()]);
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : "Unable to add labour line";
      error(message);
    }
  };

  const addPartLine = async (product: ProductSearchRow) => {
    if (!id) {
      return;
    }

    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(id)}/lines`, {
        type: "PART",
        productId: product.productId,
        variantId: product.id,
        description: product.name,
        qty: partQty,
        unitPricePence: partPrice > 0 ? partPrice : product.pricePence,
      });
      success("Part line added");
      setPartSearch("");
      setPartResults([]);
      await Promise.all([loadJob(), loadParts()]);
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : "Unable to add part line";
      error(message);
    }
  };

  const saveLine = async (lineId: string) => {
    if (!id) {
      return;
    }

    const editable = editableByLineId[lineId];
    if (!editable) {
      return;
    }

    try {
      await apiPatch(`/api/workshop/jobs/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`, {
        description: editable.description,
        qty: editable.qty,
        unitPricePence: editable.unitPricePence,
      });
      success("Line updated");
      await Promise.all([loadJob(), loadParts()]);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unable to save line";
      error(message);
    }
  };

  const removeLine = async (lineId: string) => {
    if (!id) {
      return;
    }

    try {
      await apiDelete(`/api/workshop/jobs/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`);
      success("Line removed");
      await Promise.all([loadJob(), loadParts()]);
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : "Unable to remove line";
      error(message);
    }
  };

  const addNote = async (event: FormEvent) => {
    event.preventDefault();

    if (!id) {
      return;
    }
    if (!noteDraft.trim()) {
      error("Note text is required.");
      return;
    }
    if (noteVisibility === "CUSTOMER" && !canPostCustomerNotes) {
      error("Customer-visible quote notes require MANAGER+.");
      return;
    }

    setSavingNote(true);
    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(id)}/notes`, {
        visibility: noteVisibility,
        note: noteDraft.trim(),
      });
      setNoteDraft("");
      setNoteVisibility("INTERNAL");
      success(noteVisibility === "CUSTOMER" ? "Quote note added" : "Internal note added");
      await loadNotes();
    } catch (noteError) {
      const message = noteError instanceof Error ? noteError.message : "Failed to add note";
      error(message);
    } finally {
      setSavingNote(false);
    }
  };

  const openPosHandoff = async () => {
    if (!id || !payload) {
      return;
    }

    const saleContext: SaleContext = {
      type: "WORKSHOP",
      jobId: payload.job.id,
      customerName: payload.job.customerName ?? "Workshop customer",
      bikeLabel: payload.job.bikeDescription ?? undefined,
      depositPaidPence:
        payload.job.depositStatus === "PAID"
          ? payload.job.depositRequiredPence
          : 0,
    };
    const lineItems: PosLineItem[] = payload.lines.map((line) => ({
      variantId: line.variantId,
      type: line.type,
      sku: line.variantSku,
      productName: line.productName ?? line.description,
      variantName: line.variantName,
      quantity: line.qty,
      unitPricePence: line.unitPricePence,
      lineTotalPence: line.lineTotalPence,
    }));

    if (payload?.job.sale) {
      openPosWithContext(saleContext, lineItems, {
        saleId: payload.job.sale.id,
        customerId: payload.job.customerId,
      });
      return;
    }

    if (payload?.job.finalizedBasketId) {
      openPosWithContext(saleContext, lineItems, {
        basketId: payload.job.finalizedBasketId,
        customerId: payload.job.customerId,
      });
      return;
    }

    try {
      const response = await apiPost<{ basket: { id: string } }>(
        `/api/workshop/jobs/${encodeURIComponent(id)}/finalize`,
        {},
      );
      success("Workshop handed off to POS.");
      openPosWithContext(saleContext, lineItems, {
        basketId: response.basket.id,
        customerId: payload.job.customerId,
      });
    } catch (convertError) {
      const message = convertError instanceof Error ? convertError.message : "Unable to open POS handoff";
      error(message);
    }
  };

  const reserveRequiredParts = async (requirement: JobPartRequirement) => {
    if (!id) {
      return;
    }

    const reserveQty = Math.min(requirement.outstandingQty, requirement.availableToAllocate);
    if (reserveQty <= 0) {
      error("No available stock to reserve for this requirement.");
      return;
    }

    try {
      await apiPost(`/api/workshop-jobs/${encodeURIComponent(id)}/parts`, {
        variantId: requirement.variantId,
        quantity: reserveQty,
        status: "PLANNED",
        note: "Reserved from workshop parts allocation",
      });
      success(`Reserved ${reserveQty} part${reserveQty === 1 ? "" : "s"}.`);
      await Promise.all([loadJob(), loadParts()]);
    } catch (reserveError) {
      const message = reserveError instanceof Error ? reserveError.message : "Unable to reserve parts";
      error(message);
    }
  };

  const markPartStatus = async (partId: string, status: "USED" | "RETURNED") => {
    if (!id) {
      return;
    }

    try {
      await apiPatch(`/api/workshop-jobs/${encodeURIComponent(id)}/parts/${encodeURIComponent(partId)}`, {
        status,
        note: status === "USED" ? "Consumed from workshop job" : "Returned from workshop job",
      });
      success(status === "USED" ? "Part consumed" : "Part returned");
      await Promise.all([loadJob(), loadParts()]);
    } catch (partError) {
      const message = partError instanceof Error ? partError.message : "Unable to update part status";
      error(message);
    }
  };

  const removeReservedPart = async (partId: string) => {
    if (!id) {
      return;
    }

    try {
      await apiDelete(`/api/workshop-jobs/${encodeURIComponent(id)}/parts/${encodeURIComponent(partId)}`, {
        note: "Reservation removed from workshop job",
      });
      success("Reservation removed");
      await Promise.all([loadJob(), loadParts()]);
    } catch (partError) {
      const message = partError instanceof Error ? partError.message : "Unable to remove reservation";
      error(message);
    }
  };

  const labourLines = useMemo(
    () => payload?.lines.filter((line) => line.type === "LABOUR") ?? [],
    [payload],
  );
  const partLines = useMemo(
    () => payload?.lines.filter((line) => line.type === "PART") ?? [],
    [payload],
  );

  const labourSubtotalPence = useMemo(
    () => labourLines.reduce((sum, line) => sum + line.lineTotalPence, 0),
    [labourLines],
  );
  const partsSubtotalPence = useMemo(
    () => partLines.reduce((sum, line) => sum + line.lineTotalPence, 0),
    [partLines],
  );
  const subtotalPence = labourSubtotalPence + partsSubtotalPence;
  const rawStatus = useMemo(() => getWorkshopRawStatusValue(payload?.job) ?? "", [payload?.job]);
  const displayStatus = useMemo(() => getWorkshopDisplayStatus(payload?.job) ?? "BOOKED", [payload?.job]);
  const currentEstimate = payload?.currentEstimate ?? null;
  const estimateHistory = payload?.estimateHistory ?? [];
  const latestSavedEstimate = useMemo(
    () => currentEstimate ?? estimateHistory[0] ?? null,
    [currentEstimate, estimateHistory],
  );
  const canResendQuoteNotification = currentEstimate?.status === "PENDING_APPROVAL";
  const canResendReadyNotification = displayStatus === "BIKE_READY";
  const portalConversationAccess = conversationPayload?.conversation.portalAccess ?? null;
  const currentEstimateQuoteUrl = currentEstimate?.customerQuote?.publicPath
    ? toPublicAppUrl(currentEstimate.customerQuote.publicPath)
    : null;
  const conversationPortalUrl = portalConversationAccess?.publicPath
    ? toPublicAppUrl(portalConversationAccess.publicPath)
    : currentEstimateQuoteUrl;
  const partsOverview = useMemo<PartsOverview | null>(
    () => partsPayload ?? payload?.partsOverview ?? null,
    [partsPayload, payload?.partsOverview],
  );
  const plannedPartRecords = useMemo(
    () => (partsPayload?.parts ?? []).filter((part) => part.status === "PLANNED"),
    [partsPayload?.parts],
  );
  const usedPartRecords = useMemo(
    () => (partsPayload?.parts ?? []).filter((part) => part.status === "USED"),
    [partsPayload?.parts],
  );

  const statusTimeline = useMemo(() => getWorkshopStatusTimeline(displayStatus), [displayStatus]);
  const canManuallyUpdateStatus = !["COMPLETED", "CANCELLED"].includes(displayStatus);
  const timelineEvents = timelinePayload?.events ?? [];

  const customerNotes = useMemo(
    () => notes.filter((note) => note.visibility === "CUSTOMER"),
    [notes],
  );
  const conversationMessages = conversationPayload?.messages ?? [];
  const attachments = attachmentsPayload?.attachments ?? [];
  const internalNotes = useMemo(
    () => notes.filter((note) => note.visibility === "INTERNAL"),
    [notes],
  );
  const latestCustomerNote = customerNotes[0] ?? null;
  const latestInternalNote = internalNotes[0] ?? null;
  const workflowSummary = useMemo(
    () =>
      getWorkshopTechnicianWorkflowSummary({
        rawStatus,
        partsStatus: partsOverview?.summary.partsStatus,
        assignedStaffName: payload?.job.assignedStaffName,
        scheduledDate: payload?.job.scheduledDate,
        scheduledStartAt: payload?.job.scheduledStartAt,
        hasSale: Boolean(payload?.job.sale),
        hasBasket: Boolean(payload?.job.finalizedBasketId),
      }),
    [
      partsOverview?.summary.partsStatus,
      payload?.job.assignedStaffName,
      payload?.job.finalizedBasketId,
      payload?.job.sale,
      payload?.job.scheduledDate,
      payload?.job.scheduledStartAt,
      rawStatus,
    ],
  );
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );
  useEffect(() => {
    setSelectedOptionalTemplateLineIds(getDefaultSelectedOptionalLineIds(selectedTemplate));
  }, [selectedTemplate]);
  const workshopCalendarPath = payload?.job.scheduledDate
    ? `/workshop/calendar?date=${payload.job.scheduledDate.slice(0, 10)}`
    : "/workshop/calendar";
  const latestTimelineEvent = useMemo(
    () => getMostRecentEntry(timelineEvents, (event) => event.occurredAt),
    [timelineEvents],
  );
  const latestConversationMessage = useMemo(
    () => getMostRecentEntry(
      conversationMessages,
      (message) => message.sentAt ?? message.receivedAt ?? message.createdAt,
    ),
    [conversationMessages],
  );
  const liveEstimateChanged = Boolean(
    payload
    && currentEstimate
    && (
      currentEstimate.subtotalPence !== subtotalPence
      || currentEstimate.lineCount !== payload.lines.length
    ),
  );
  const estimateNeedsRefresh = Boolean(
    (currentEstimate?.status === "APPROVED" && liveEstimateChanged)
    || (!currentEstimate && latestSavedEstimate?.status === "APPROVED" && payload?.lines.length)
    || portalConversationAccess?.hasUpdatedEstimate,
  );
  const depositPaidPence = payload?.job.depositStatus === "PAID" ? payload.job.depositRequiredPence : 0;
  const estimatedRemainingPence = Math.max(subtotalPence - depositPaidPence, 0);
  const estimateSignal = useMemo<WorkshopJobSignal>(() => {
    if (!payload || payload.lines.length === 0) {
      return {
        label: "No quote yet",
        detail: "Add labour or parts before the workshop can send, approve, or bill a meaningful estimate.",
        className: "status-badge",
      };
    }

    if (!currentEstimate && latestSavedEstimate?.status === "APPROVED" && payload.lines.length > 0) {
      return {
        label: "Changed after approval",
        detail: `The last approved quote was ${formatMoney(latestSavedEstimate.subtotalPence)}, but the live job now totals ${formatMoney(subtotalPence)} and needs a fresh version.`,
        className: "status-badge status-warning",
      };
    }

    if (!currentEstimate) {
      return {
        label: "Live work not saved",
        detail: `Current lines total ${formatMoney(subtotalPence)}, but no quote snapshot exists yet.`,
        className: "status-badge status-info",
      };
    }

    if (currentEstimate.status === "APPROVED" && estimateNeedsRefresh) {
      return {
        label: "Changed after approval",
        detail: `Approved quote was ${formatMoney(currentEstimate.subtotalPence)} and the live job is now ${formatMoney(subtotalPence)}. Save a new version before continuing or collecting.`,
        className: "status-badge status-warning",
      };
    }

    if (currentEstimate.status === "PENDING_APPROVAL") {
      return {
        label: "Awaiting approval",
        detail: currentEstimate.requestedAt
          ? `Quote sent ${formatOptionalDateTime(currentEstimate.requestedAt)} and still needs a decision.`
          : "The current quote still needs customer approval before work moves on.",
        className: "status-badge status-warning",
      };
    }

    if (currentEstimate.status === "APPROVED") {
      return {
        label: "Approved to proceed",
        detail: currentEstimate.approvedAt
          ? `Customer approval recorded ${formatOptionalDateTime(currentEstimate.approvedAt)}.`
          : "The current quote is already approved.",
        className: "status-badge status-complete",
      };
    }

    if (currentEstimate.status === "REJECTED") {
      return {
        label: "Quote rejected",
        detail: currentEstimate.rejectedAt
          ? `Latest quote was rejected ${formatOptionalDateTime(currentEstimate.rejectedAt)} and should be revised before more work starts.`
          : "The current quote was rejected and needs revision.",
        className: "status-badge status-cancelled",
      };
    }

    return {
      label: "Draft quote",
      detail: `Version ${(currentEstimate ?? latestSavedEstimate)?.version ?? "-"} is saved, but it has not been sent for approval yet.`,
      className: "status-badge status-info",
    };
  }, [currentEstimate, estimateNeedsRefresh, latestSavedEstimate, payload, subtotalPence]);
  const collectionSignal = useMemo<WorkshopJobSignal>(() => {
    if (!payload) {
      return {
        label: "Collection unavailable",
        detail: "Load the job before collection handoff can be assessed.",
        className: "status-badge",
      };
    }

    if (payload.job.sale) {
      return {
        label: "Sale linked",
        detail: `Sale ${payload.job.sale.id.slice(0, 8)} is already linked for ${formatMoney(payload.job.sale.totalPence)}.`,
        className: "status-badge status-complete",
      };
    }

    if (payload.job.finalizedBasketId) {
      return {
        label: "POS handoff ready",
        detail: `Basket ${payload.job.finalizedBasketId.slice(0, 8)} is prepared and can be opened in POS.`,
        className: "status-badge status-info",
      };
    }

    if (displayStatus === "BIKE_READY") {
      return {
        label: "Needs POS handoff",
        detail: "The bike is ready, but staff still need to open the checkout path in POS before collection.",
        className: "status-badge status-warning",
      };
    }

    return {
      label: "Not ready for collection",
      detail: "Collection state will become actionable once bench work, estimate state, and bike readiness all line up.",
      className: "status-badge",
    };
  }, [displayStatus, payload]);
  const latestActivityHighlights = useMemo<WorkshopJobActivityHighlight[]>(() => {
    const highlights: WorkshopJobActivityHighlight[] = [
      latestTimelineEvent
        ? {
            label: "Latest system event",
            detail: `${latestTimelineEvent.label} · ${formatOptionalDateTime(latestTimelineEvent.occurredAt)}`,
          }
        : {
            label: "Latest system event",
            detail: "No domain-event activity has been recorded yet.",
          },
      latestConversationMessage
        ? {
            label: "Latest customer contact",
            detail: `${latestConversationMessage.direction === "OUTBOUND" ? "Workshop message" : "Customer reply"} · ${formatOptionalDateTime(latestConversationMessage.sentAt ?? latestConversationMessage.receivedAt ?? latestConversationMessage.createdAt)}`,
          }
        : latestCustomerNote
          ? {
              label: "Latest customer note",
              detail: `${truncateText(latestCustomerNote.note, 88)} · ${formatOptionalDateTime(latestCustomerNote.createdAt)}`,
            }
          : {
              label: "Latest customer contact",
              detail: "No customer-facing message or note has been recorded yet.",
            },
      latestInternalNote
        ? {
            label: "Latest internal note",
            detail: `${truncateText(latestInternalNote.note, 88)} · ${formatOptionalDateTime(latestInternalNote.createdAt)}`,
          }
        : {
            label: "Latest internal note",
            detail: "No internal workshop notes have been added yet.",
          },
    ];

    return highlights;
  }, [latestConversationMessage, latestCustomerNote, latestInternalNote, latestTimelineEvent]);
  const nextAction = useMemo<WorkshopJobNextAction>(() => {
    if (!payload || payload.lines.length === 0) {
      return {
        title: "Build the first estimate",
        detail: "This job has context, but no chargeable work has been added yet.",
        highlights: [
          payload?.job.notes ? truncateText(payload.job.notes, 96) : "Capture the first labour or parts line.",
          workflowSummary.assignmentSummary,
          payload?.job.scheduledDate ? `Promise date ${formatOptionalDateTime(payload.job.scheduledDate)}` : "No promise date set",
        ],
        actionKind: "jumpToBuild",
        actionLabel: "Jump to labour & parts",
      };
    }

    if (!currentEstimate && latestSavedEstimate?.status === "APPROVED") {
      return {
        title: "Re-issue the quote",
        detail: "The last approved version no longer matches the live work, so staff should save and resend a revised estimate before carrying on.",
        highlights: [
          `Last approved ${formatMoney(latestSavedEstimate.subtotalPence)}`,
          `Live total ${formatMoney(subtotalPence)}`,
          workflowSummary.assignmentSummary,
        ],
        actionKind: "saveEstimate",
        actionLabel: "Save revised quote",
      };
    }

    if (!currentEstimate) {
      return {
        title: "Capture the current quote",
        detail: "The live line set is ready, but it has not been saved as an auditable estimate version yet.",
        highlights: [
          `Current total ${formatMoney(subtotalPence)}`,
          `${payload.lines.length} live line${payload.lines.length === 1 ? "" : "s"} ready to snapshot`,
          workflowSummary.assignmentSummary,
        ],
        actionKind: "saveEstimate",
        actionLabel: "Save quote snapshot",
      };
    }

    if (currentEstimate.status === "APPROVED" && estimateNeedsRefresh) {
      return {
        title: "Re-issue the quote",
        detail: "Work changed after approval, so the workshop should save and resend a fresh version before bench work or collection continues.",
        highlights: [
          `Approved ${formatMoney(currentEstimate.subtotalPence)}`,
          `Live total ${formatMoney(subtotalPence)}`,
          portalConversationAccess?.hasUpdatedEstimate ? "Portal link is tied to an older estimate version" : "Approval record no longer matches the live work",
        ],
        actionKind: "saveEstimate",
        actionLabel: "Save revised quote",
      };
    }

    if (currentEstimate.status === "DRAFT" || currentEstimate.status === "REJECTED") {
      return {
        title: currentEstimate.status === "REJECTED" ? "Revise and resend the quote" : "Send the quote for approval",
        detail: currentEstimate.status === "REJECTED"
          ? "The latest quote was declined, so the next best step is to prepare an updated customer-facing version."
          : "The job is commercially ready, but staff still need to send or share the quote with the customer.",
        highlights: [
          `Current version v${currentEstimate.version}`,
          `Live total ${formatMoney(subtotalPence)}`,
          workflowSummary.assignmentSummary,
        ],
        actionKind: "prepareQuote",
        actionLabel: currentEstimate.customerQuote?.status === "ACTIVE" ? "Copy customer quote link" : "Prepare customer quote link",
      };
    }

    if (currentEstimate.status === "PENDING_APPROVAL") {
      return {
        title: "Review customer approval",
        detail: "Bench work should stay aligned with the current approval state and portal access.",
        highlights: [
          currentEstimate.requestedAt ? `Quote sent ${formatOptionalDateTime(currentEstimate.requestedAt)}` : "Approval request already sent",
          portalConversationAccess?.publicPath ? "Portal access is live for customer replies" : "No active portal link yet",
          workflowSummary.assignmentSummary,
        ],
        actionKind: "prepareQuote",
        actionLabel: currentEstimate.customerQuote?.status === "ACTIVE" ? "Copy customer quote link" : "Prepare customer quote link",
      };
    }

    if ((displayStatus === "BOOKED" || displayStatus === "BIKE_ARRIVED" || displayStatus === "APPROVED") && currentEstimate.status === "APPROVED") {
      return {
        title: "Move work onto the bench",
        detail: "Customer approval is in place, so the next operational step is to start the repair and keep the board truthful.",
        highlights: [
          workflowSummary.assignmentSummary,
          payload.job.scheduledStartAt ? `Scheduled ${formatOptionalDateTime(payload.job.scheduledStartAt)}` : "No timed slot yet",
          partsOverview?.summary.partsStatus === "SHORT" ? "Parts are still short for this job" : "Parts state is not currently blocking bench work",
        ],
        actionKind: "moveToBench",
        actionLabel: "Move to bench",
      };
    }

    if (displayStatus === "WAITING_FOR_PARTS") {
      return {
        title: "Resolve the parts blocker",
        detail: "The job is operationally blocked on stock or allocation rather than estimate state.",
        highlights: [
          `${partsOverview?.summary.missingQty ?? 0} missing item${partsOverview?.summary.missingQty === 1 ? "" : "s"}`,
          `${partsOverview?.summary.outstandingQty ?? 0} still outstanding`,
          workflowSummary.assignmentSummary,
        ],
        actionKind: "jumpToParts",
        actionLabel: "Review parts allocation",
      };
    }

    if (displayStatus === "BIKE_READY") {
      return {
        title: "Complete the collection handoff",
        detail: "Bench work is done. Staff now need to open or reuse the POS path so payment and collection finish cleanly.",
        highlights: [
          collectionSignal.label,
          formatWorkshopDepositState(payload.job.depositStatus, payload.job.depositRequiredPence),
          estimatedRemainingPence > 0 ? `Estimated remaining ${formatMoney(estimatedRemainingPence)}` : "No remaining balance estimated from the current quote",
        ],
        actionKind: "openPosHandoff",
        actionLabel: payload.job.sale ? "Open linked sale" : payload.job.finalizedBasketId ? "Open POS handoff" : "Start POS handoff",
      };
    }

    return {
      title: workflowSummary.label,
      detail: workflowSummary.detail,
      highlights: [
        workflowSummary.nextStep,
        workflowSummary.assignmentSummary,
        collectionSignal.detail,
      ],
      actionKind: null,
      actionLabel: null,
    };
  }, [
    collectionSignal.detail,
    collectionSignal.label,
    currentEstimate,
    displayStatus,
    estimateNeedsRefresh,
    estimatedRemainingPence,
    latestSavedEstimate,
    partsOverview?.summary.missingQty,
    partsOverview?.summary.outstandingQty,
    partsOverview?.summary.partsStatus,
    payload,
    portalConversationAccess?.hasUpdatedEstimate,
    portalConversationAccess?.publicPath,
    subtotalPence,
    workflowSummary,
  ]);

  if (!id) {
    return <div className="page-shell"><p>Missing workshop job id.</p></div>;
  }

  return (
    <div className="page-shell">
      <section className="card" id="workshop-job-overview">
        <div className="workshop-job-header">
          <div className="workshop-job-header__identity">
            <div className="actions-inline workshop-job-header__breadcrumbs">
              <Link to="/workshop" className="button-link button-link-compact">
                Workshop board
              </Link>
              <Link to="/workshop/collection" className="button-link button-link-compact">
                Collection queue
              </Link>
            </div>
            <span className="table-secondary">Workshop job {id.slice(0, 8)}</span>
            <h1>{payload?.job.customerName || "Workshop Job"}</h1>
            <p className="muted-text">
              {payload?.job.bikeDescription || "Bike details still to be confirmed"}
              {payload?.job.assignedStaffName ? ` · ${payload.job.assignedStaffName}` : ""}
            </p>
            {payload ? (
              <div className="workshop-job-header__badges">
                <span className={workshopRawStatusClass(displayStatus)}>{workshopRawStatusLabel(displayStatus)}</span>
                <span className={workshopTechnicianWorkflowClass(workflowSummary.stage)}>
                  {workshopTechnicianWorkflowLabel(workflowSummary.stage)}
                </span>
                <span className={estimateSignal.className}>{estimateSignal.label}</span>
                <span className={partsStatusClass(partsOverview?.summary.partsStatus)}>
                  Parts {partsOverview?.summary.partsStatus ?? "OK"}
                </span>
                <span className={collectionSignal.className}>{collectionSignal.label}</span>
              </div>
            ) : null}
          </div>

          <div className="workshop-job-status-panel" ref={statusMenuRef}>
            <div className="workshop-job-status-panel__header">
              <span className="table-secondary">Workshop activity</span>
              <div className="workshop-job-status-panel__tabs" role="tablist" aria-label="Workshop activity views">
                <button
                  type="button"
                  role="tab"
                  aria-selected={statusPanelTab === "progress"}
                  className={`workshop-job-status-panel__tab${statusPanelTab === "progress" ? " workshop-job-status-panel__tab--active" : ""}`}
                  onClick={() => setStatusPanelTab("progress")}
                >
                  Progress
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={statusPanelTab === "timeline"}
                  className={`workshop-job-status-panel__tab${statusPanelTab === "timeline" ? " workshop-job-status-panel__tab--active" : ""}`}
                  onClick={() => setStatusPanelTab("timeline")}
                >
                  Timeline
                </button>
              </div>
            </div>
            <button
              type="button"
              className={`workshop-job-status-trigger ${workshopRawStatusActionClass(displayStatus)}`}
              onClick={() => {
                if (!canManuallyUpdateStatus || !payload) {
                  return;
                }
                setStatusMenuOpen((open) => !open);
              }}
              disabled={!payload || !canManuallyUpdateStatus || updatingStatus}
              aria-haspopup="menu"
              aria-expanded={statusMenuOpen}
            >
              <span>{workshopRawStatusLabel(displayStatus)}</span>
              <span className="workshop-job-status-trigger__meta">
                {updatingStatus ? "Updating..." : canManuallyUpdateStatus ? "Change" : "Locked"}
              </span>
            </button>

            {statusMenuOpen && payload ? (
              <div className="workshop-job-status-menu" role="menu" aria-label="Workshop statuses">
                {workshopStatusSelectorOptions.map((option) => {
                  const isCurrent = option.value === displayStatus;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isCurrent}
                      className={`workshop-job-status-option ${workshopRawStatusActionClass(option.value)}${isCurrent ? " workshop-job-status-option--current" : ""}`}
                      onClick={() => void updateStageStatus(option.value)}
                      disabled={updatingStatus || isCurrent}
                    >
                      <span className="workshop-job-status-option__content">
                        <strong>{option.label}</strong>
                        <span>{option.description}</span>
                      </span>
                      <span className="workshop-job-status-option__state">
                        {isCurrent ? "Current" : "Set"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {statusPanelTab === "progress" ? (
              <>
                <div className="workshop-job-status-timeline" aria-label="Workshop progress">
                  {statusTimeline.map((step) => (
                    <div
                      key={step.status}
                      className={`workshop-job-status-timeline__step workshop-job-status-timeline__step--${step.state}`}
                    >
                      <span className="workshop-job-status-timeline__dot" />
                      <span className="workshop-job-status-timeline__label">{step.label}</span>
                    </div>
                  ))}
                </div>

                <p className="workshop-job-status-panel__hint">
                  {canManuallyUpdateStatus
                    ? "Automatic workshop updates still apply. Manual changes save immediately and are audited."
                    : "Completed and cancelled jobs stay locked so handoff history remains trustworthy."}
                </p>
              </>
            ) : (
              <div className="workshop-job-event-timeline">
                <div className="workshop-job-event-timeline__header">
                  <p className="workshop-job-status-panel__hint">
                    Persistent domain-event activity for this job, with recent in-memory events merged in during active work.
                  </p>
                  <button type="button" className="button-link" onClick={() => void loadTimeline()} disabled={timelineLoading}>
                    {timelineLoading ? "Refreshing..." : "Refresh"}
                  </button>
                </div>

                {timelineEvents.length ? (
                  <ol className="workshop-job-event-timeline__list">
                    {timelineEvents.map((event) => (
                      <li key={event.id} className="workshop-job-event-timeline__item">
                        <div className="workshop-job-event-timeline__marker" />
                        <div className="workshop-job-event-timeline__content">
                          <div className="workshop-job-event-timeline__item-header">
                            <strong>{event.label}</strong>
                            <span className="table-secondary">{new Date(event.occurredAt).toLocaleString()}</span>
                          </div>
                          <p>{event.description}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="restricted-panel info-panel">
                    {timelineLoading
                      ? "Loading workshop timeline..."
                      : "No domain events have been recorded for this workshop job yet."}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="actions-inline workshop-job-header__actions">
            <Link to={workshopCalendarPath} className="button-link">
              Calendar
            </Link>
            {payload?.job.bike ? (
              <Link to={`/customers/bikes/${payload.job.bike.id}`} className="button-link">
                Bike History
              </Link>
            ) : null}
            {payload && !["COMPLETED", "CANCELLED"].includes(displayStatus) ? (
              <button type="button" className="primary" onClick={openPosHandoff} data-testid="workshop-job-open-pos">
                {payload.job.sale
                  ? "Open sale"
                  : payload.job.finalizedBasketId
                    ? "Open POS handoff"
                    : "Send to POS"}
              </button>
            ) : null}
            <a
              href={toBackendUrl(`/workshop/${encodeURIComponent(id)}/print`)}
              target="_blank"
              rel="noreferrer"
              className="button-link"
            >
              Print Job
            </a>
          </div>
        </div>

        {loading ? <p>Loading...</p> : null}

        {payload ? (
          <>
            <nav className="workshop-job-anchor-nav" aria-label="Workshop job sections">
              <a href="#workshop-job-estimate" className="button-link button-link-compact">Estimate</a>
              <a href="#workshop-job-parts" className="button-link button-link-compact">Parts</a>
              <a href="#workshop-job-progress" className="button-link button-link-compact">Progress</a>
              <a href="#workshop-job-conversation" className="button-link button-link-compact">Customer updates</a>
              <a href="#workshop-job-build" className="button-link button-link-compact">Build work</a>
            </nav>

            <div className="workshop-job-hub">
              <div className="workshop-job-hub__main">
                <section className="workshop-job-priority-card" data-testid="workshop-job-next-action">
                  <span className="ui-page-eyebrow">Next action</span>
                  <div className="workshop-job-priority-card__headline">
                    <div>
                      <h2>{nextAction.title}</h2>
                      <p className="muted-text">{nextAction.detail}</p>
                    </div>
                    <span className={workflowSummary.blockerClassName}>{workflowSummary.blockerLabel}</span>
                  </div>

                  <div className="workshop-job-priority-card__highlights">
                    {nextAction.highlights.map((highlight) => (
                      <div key={highlight} className="workshop-job-priority-card__highlight">
                        {highlight}
                      </div>
                    ))}
                  </div>

                  <div className="actions-inline">
                    {nextAction.actionKind === "saveEstimate" ? (
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void saveEstimateSnapshot()}
                        disabled={savingEstimate || payload.lines.length === 0}
                      >
                        {savingEstimate ? "Saving Snapshot..." : nextAction.actionLabel}
                      </button>
                    ) : null}
                    {nextAction.actionKind === "prepareQuote" ? (
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void prepareCustomerQuoteLink()}
                        disabled={preparingCustomerQuote || payload.lines.length === 0}
                      >
                        {preparingCustomerQuote ? "Preparing Quote Link..." : nextAction.actionLabel}
                      </button>
                    ) : null}
                    {nextAction.actionKind === "moveToBench" ? (
                      <button type="button" className="primary" onClick={() => void updateStageStatus("IN_PROGRESS")} disabled={updatingStatus}>
                        {nextAction.actionLabel}
                      </button>
                    ) : null}
                    {nextAction.actionKind === "openPosHandoff" ? (
                      <button type="button" className="primary" onClick={openPosHandoff}>
                        {nextAction.actionLabel}
                      </button>
                    ) : null}
                    {nextAction.actionKind === "jumpToBuild" ? (
                      <a href="#workshop-job-build" className="button-link">
                        {nextAction.actionLabel}
                      </a>
                    ) : null}
                    {nextAction.actionKind === "jumpToParts" ? (
                      <a href="#workshop-job-parts" className="button-link">
                        {nextAction.actionLabel}
                      </a>
                    ) : null}
                    <a href="#workshop-job-progress" className="button-link">
                      Review progress
                    </a>
                  </div>
                </section>

                <div className="workshop-job-signal-grid">
                  <article className="workshop-job-signal-card workshop-job-signal-card--estimate" data-testid="workshop-job-estimate-state">
                    <div className="workshop-job-signal-card__header">
                      <div>
                        <span className="table-secondary">Estimate & approval</span>
                        <h3>{estimateSignal.label}</h3>
                      </div>
                      <span className={estimateSignal.className}>{estimateSignal.label}</span>
                    </div>
                    <p className="muted-text">{estimateSignal.detail}</p>

                    <div className="workshop-job-signal-card__meta">
                      <div>
                        <span className="metric-label">Live total</span>
                        <strong>{formatMoney(subtotalPence)}</strong>
                      </div>
                      <div>
                        <span className="metric-label">Current version</span>
                        <strong>{latestSavedEstimate ? `v${latestSavedEstimate.version}` : "Not saved"}</strong>
                      </div>
                      <div>
                        <span className="metric-label">Saved total</span>
                        <strong>{latestSavedEstimate ? formatMoney(latestSavedEstimate.subtotalPence) : "-"}</strong>
                      </div>
                      <div>
                        <span className="metric-label">Portal</span>
                        <strong>
                          {currentEstimate?.customerQuote
                            ? workshopCustomerQuoteLinkStatusLabel(currentEstimate.customerQuote.status)
                            : "Not prepared"}
                        </strong>
                      </div>
                    </div>

                    <div className="workshop-job-signal-card__stack">
                      <div className="actions-inline">
                        {canPersistApprovalStatus(displayStatus) ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void saveEstimateSnapshot()}
                              disabled={savingEstimate || payload.lines.length === 0}
                            >
                              {savingEstimate ? "Saving Snapshot..." : "Save quote snapshot"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void updateApprovalStatus("WAITING_FOR_APPROVAL")}
                              disabled={currentEstimate?.status === "PENDING_APPROVAL" || payload.lines.length === 0}
                            >
                              Send quote
                            </button>
                            <button
                              type="button"
                              onClick={() => void updateApprovalStatus("APPROVED")}
                              disabled={currentEstimate?.status === "APPROVED" || payload.lines.length === 0}
                            >
                              Mark approved
                            </button>
                            <button
                              type="button"
                              onClick={() => void updateApprovalStatus("REJECTED")}
                              disabled={currentEstimate?.status === "REJECTED" || payload.lines.length === 0}
                            >
                              Mark rejected
                            </button>
                            <button
                              type="button"
                              className="primary"
                              onClick={() => void prepareCustomerQuoteLink()}
                              disabled={preparingCustomerQuote || payload.lines.length === 0}
                            >
                              {preparingCustomerQuote
                                ? "Preparing Quote Link..."
                                : currentEstimate?.customerQuote?.status === "ACTIVE"
                                  ? "Copy customer quote link"
                                  : "Prepare customer quote link"}
                            </button>
                          </>
                        ) : (
                          <span className="muted-text">Quote actions are limited by the current lifecycle state.</span>
                        )}
                      </div>

                      <div className="workshop-job-summary-list">
                        <div>
                          <span className="metric-label">Approval decision</span>
                          <strong>{estimateDecisionSourceLabel(latestSavedEstimate?.decisionSource)}</strong>
                        </div>
                        <div>
                          <span className="metric-label">Requested</span>
                          <strong>{formatOptionalDateTime(latestSavedEstimate?.requestedAt)}</strong>
                        </div>
                        <div>
                          <span className="metric-label">Approved</span>
                          <strong>{formatOptionalDateTime(latestSavedEstimate?.approvedAt)}</strong>
                        </div>
                        <div>
                          <span className="metric-label">Rejected</span>
                          <strong>{formatOptionalDateTime(latestSavedEstimate?.rejectedAt)}</strong>
                        </div>
                        <div>
                          <span className="metric-label">Portal expiry</span>
                          <strong>{formatOptionalDateTime(latestSavedEstimate?.customerQuote?.expiresAt ?? null)}</strong>
                        </div>
                        <div>
                          <span className="metric-label">Quote drift</span>
                          <strong>{estimateNeedsRefresh ? "Needs refresh" : "Aligned"}</strong>
                        </div>
                      </div>
                    </div>

                    {currentEstimateQuoteUrl ? (
                      <div className="actions-inline">
                        <a href={currentEstimateQuoteUrl} target="_blank" rel="noreferrer" className="button-link button-link-compact">
                          Open customer portal
                        </a>
                        <code>{currentEstimateQuoteUrl}</code>
                      </div>
                    ) : null}
                  </article>

                  <article className="workshop-job-signal-card" data-testid="workshop-job-activity-summary">
                    <div className="workshop-job-signal-card__header">
                      <div>
                        <span className="table-secondary">Progress narrative</span>
                        <h3>Latest meaningful activity</h3>
                      </div>
                      <button type="button" className="button-link" onClick={() => void loadTimeline()} disabled={timelineLoading}>
                        {timelineLoading ? "Refreshing..." : "Refresh timeline"}
                      </button>
                    </div>
                    <p className="muted-text">
                      Internal notes, customer contact, and domain events are separated here so staff can see the most important recent movement without scanning every section below.
                    </p>
                    <div className="workshop-job-highlight-list">
                      {latestActivityHighlights.map((highlight) => (
                        <div key={highlight.label} className="workshop-job-highlight-list__item">
                          <span className="metric-label">{highlight.label}</span>
                          <strong>{highlight.detail}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="actions-inline">
                      <a href="#workshop-job-progress" className="button-link">Open notes</a>
                      <a href="#workshop-job-conversation" className="button-link">Open customer updates</a>
                    </div>
                  </article>
                </div>
              </div>

              <aside className="workshop-job-hub__side">
                <article className="workshop-job-signal-card" data-testid="workshop-job-collection-state">
                  <div className="workshop-job-signal-card__header">
                    <div>
                      <span className="table-secondary">Collection & handoff</span>
                      <h3>{collectionSignal.label}</h3>
                    </div>
                    <span className={collectionSignal.className}>{collectionSignal.label}</span>
                  </div>
                  <p className="muted-text">{collectionSignal.detail}</p>
                  <div className="workshop-job-summary-list">
                    <div>
                      <span className="metric-label">Deposit</span>
                      <strong>{formatWorkshopDepositState(payload.job.depositStatus, payload.job.depositRequiredPence)}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Estimated remaining</span>
                      <strong>{formatMoney(estimatedRemainingPence)}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Sale / basket</span>
                      <strong>{payload.job.sale ? `Sale ${payload.job.sale.id.slice(0, 8)}` : payload.job.finalizedBasketId ? `Basket ${payload.job.finalizedBasketId.slice(0, 8)}` : "None yet"}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Customer pickup note</span>
                      <strong>{latestCustomerNote ? truncateText(latestCustomerNote.note, 72) : "No customer pickup note"}</strong>
                    </div>
                  </div>
                  <div className="actions-inline">
                    {(payload.job.sale || payload.job.finalizedBasketId || displayStatus === "BIKE_READY") ? (
                      <button type="button" className="primary" onClick={openPosHandoff}>
                        {payload.job.sale ? "Open linked sale" : payload.job.finalizedBasketId ? "Open POS handoff" : "Start POS handoff"}
                      </button>
                    ) : null}
                    <Link to="/workshop/collection" className="button-link">
                      Open collection queue
                    </Link>
                  </div>
                </article>

                <article className="workshop-job-signal-card">
                  <div className="workshop-job-signal-card__header">
                    <div>
                      <span className="table-secondary">Service snapshot</span>
                      <h3>Customer, bike, timing, and blocker</h3>
                    </div>
                    <span className={workflowSummary.blockerClassName}>{workflowSummary.blockerLabel}</span>
                  </div>
                  <div className="workshop-job-summary-list">
                    <div>
                      <span className="metric-label">Customer</span>
                      <strong>{payload.job.customerName || "Customer pending"}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Bike</span>
                      <strong>{payload.job.bikeDescription || "Bike details pending"}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Linked bike record</span>
                      <strong>
                        {payload.job.bike ? (
                          <Link to={`/customers/bikes/${payload.job.bike.id}`}>{payload.job.bike.displayName}</Link>
                        ) : "No linked bike record"}
                      </strong>
                    </div>
                    <div>
                      <span className="metric-label">Technician</span>
                      <strong>{payload.job.assignedStaffName || "Unassigned"}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Scheduled</span>
                      <strong>{formatOptionalDateTime(payload.job.scheduledStartAt || payload.job.scheduledDate)}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Parts state</span>
                      <strong>{partsOverview?.summary.partsStatus ?? "OK"}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Next bench step</span>
                      <strong>{workflowSummary.nextStep}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Updated</span>
                      <strong>{new Date(payload.job.updatedAt).toLocaleString()}</strong>
                    </div>
                  </div>
                  {payload.job.notes ? (
                    <div className="restricted-panel">
                      <strong>Check-in summary</strong>
                      <p className="muted-text" style={{ marginBottom: 0 }}>{payload.job.notes}</p>
                    </div>
                  ) : null}
                </article>
              </aside>
            </div>
          </>
        ) : null}
      </section>

      <section className="card" id="workshop-job-bike">
        <div className="card-header-row">
          <div>
            <h2>Bike Record</h2>
            <p className="muted-text">
              Keep the workshop summary compatible with existing flows, and optionally link a reusable customer bike record for future service history and faster intake.
            </p>
          </div>
          {payload?.job.bike ? (
            <Link to={`/customers/bikes/${payload.job.bike.id}`} className="button-link">
              Bike Service History
            </Link>
          ) : null}
          {payload?.job.customerId ? (
            <div className="table-secondary">
              {customerBikesLoading ? "Loading customer bikes..." : `${customerBikes.length} bike record${customerBikes.length === 1 ? "" : "s"}`}
            </div>
          ) : null}
        </div>

        <div className="job-meta-grid">
          <label className="grow">
            Workshop bike summary
            <input
              value={bikeDescriptionDraft}
              onChange={(event) => setBikeDescriptionDraft(event.target.value)}
              placeholder="Shown across workshop, collection, and POS handoff surfaces"
            />
          </label>
          {payload?.job.customerId ? (
            <label>
              Linked customer bike
              <select
                value={createBikeInline ? "__new__" : selectedBikeId}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (nextValue === "__new__") {
                    setCreateBikeInline(true);
                    setSelectedBikeId("");
                    return;
                  }

                  setCreateBikeInline(false);
                  setSelectedBikeId(nextValue);
                  const matchedBike = customerBikes.find((bike) => bike.id === nextValue);
                  if (matchedBike) {
                    setBikeDescriptionDraft(matchedBike.displayName);
                  }
                }}
              >
                <option value="">No linked bike record</option>
                {customerBikes.map((bike) => (
                  <option key={bike.id} value={bike.id}>
                    {bike.displayName}
                  </option>
                ))}
                <option value="__new__">Create new bike record</option>
              </select>
            </label>
          ) : (
            <div className="restricted-panel">
              Attach a customer first if you want this job linked to a reusable bike record.
            </div>
          )}
        </div>

        {payload?.job.bike ? (
          <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
            <div className="job-meta-grid">
              <div><strong>Current record:</strong> {payload.job.bike.displayName}</div>
              <div>
                <strong>History:</strong>{" "}
                <Link to={`/customers/bikes/${payload.job.bike.id}`}>Open linked bike service history</Link>
              </div>
              <div><strong>Make / Model:</strong> {[payload.job.bike.make, payload.job.bike.model].filter(Boolean).join(" ") || "-"}</div>
              <div><strong>Colour:</strong> {payload.job.bike.colour || "-"}</div>
              <div><strong>Frame #:</strong> {payload.job.bike.frameNumber || "-"}</div>
              <div><strong>Serial #:</strong> {payload.job.bike.serialNumber || "-"}</div>
              <div><strong>Registration:</strong> {payload.job.bike.registrationNumber || "-"}</div>
              <div><strong>Bike notes:</strong> {payload.job.bike.notes || "-"}</div>
            </div>
          </div>
        ) : null}

        {!payload?.job.bike && payload?.job.bikeDescription ? (
          <div className="restricted-panel" style={{ marginTop: "12px" }}>
            This job still uses a free-text bike summary only. It stays operationally compatible, but it will not appear in reusable bike service history until a real bike record is linked.
          </div>
        ) : null}

        {payload?.job.customerId && createBikeInline ? (
          <div className="job-meta-grid" style={{ marginTop: "12px" }}>
            <label>
              Nickname / label
              <input value={bikeLabelDraft} onChange={(event) => setBikeLabelDraft(event.target.value)} placeholder="e.g. Winter commuter" />
            </label>
            <label>
              Make
              <input value={bikeMakeDraft} onChange={(event) => setBikeMakeDraft(event.target.value)} placeholder="Trek" />
            </label>
            <label>
              Model
              <input value={bikeModelDraft} onChange={(event) => setBikeModelDraft(event.target.value)} placeholder="Domane AL 2" />
            </label>
            <label>
              Colour
              <input value={bikeColourDraft} onChange={(event) => setBikeColourDraft(event.target.value)} placeholder="Blue" />
            </label>
            <label>
              Frame number
              <input value={bikeFrameDraft} onChange={(event) => setBikeFrameDraft(event.target.value)} />
            </label>
            <label>
              Serial number
              <input value={bikeSerialDraft} onChange={(event) => setBikeSerialDraft(event.target.value)} />
            </label>
            <label>
              Registration
              <input value={bikeRegistrationDraft} onChange={(event) => setBikeRegistrationDraft(event.target.value)} />
            </label>
            <label className="grow">
              Bike notes
              <textarea value={bikeNotesDraft} onChange={(event) => setBikeNotesDraft(event.target.value)} rows={3} />
            </label>
          </div>
        ) : null}

        <div className="actions-inline" style={{ marginTop: "12px" }}>
          <button type="button" className="primary" onClick={() => void saveBikeRecordLink()} disabled={savingBikeLink}>
            {savingBikeLink ? "Saving..." : "Save Bike Details"}
          </button>
          {payload?.job.customerId && !createBikeInline ? (
            <button
              type="button"
              onClick={() => {
                setCreateBikeInline(true);
                setSelectedBikeId("");
              }}
            >
              Create Bike Record
            </button>
          ) : null}
        </div>
      </section>

      <section className="card" id="workshop-job-estimate">
        <div className="card-header-row">
          <div>
            <h2>Estimate</h2>
            <p className="muted-text">
              Live labour and parts still drive workshop pricing, while saved quote snapshots preserve approval state, customer links, and audit history.
            </p>
          </div>
        </div>

        <div className="metric-grid">
          <div className="metric-card">
            <span className="metric-label">Labour Lines</span>
            <strong className="metric-value">{labourLines.length}</strong>
            <span className="table-secondary">{formatMoney(labourSubtotalPence)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Part Lines</span>
            <strong className="metric-value">{partLines.length}</strong>
            <span className="table-secondary">{formatMoney(partsSubtotalPence)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Quote Notes</span>
            <strong className="metric-value">{customerNotes.length}</strong>
            <span className="table-secondary">Customer-visible notes</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Estimate Total</span>
            <strong className="metric-value">{formatMoney(subtotalPence)}</strong>
            <span className="table-secondary">Auto-refreshes with line changes</span>
          </div>
        </div>

        {currentEstimate ? (
          <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
            <div className="job-meta-grid">
              <div>
                <strong>Current estimate:</strong>{" "}
                <span className={workshopEstimateStatusClass(currentEstimate.status)}>
                  v{currentEstimate.version} · {workshopEstimateStatusLabel(currentEstimate.status)}
                </span>
              </div>
              <div><strong>Saved total:</strong> {formatMoney(currentEstimate.subtotalPence)}</div>
              <div><strong>Requested:</strong> {formatOptionalDateTime(currentEstimate.requestedAt)}</div>
              <div><strong>Approved:</strong> {formatOptionalDateTime(currentEstimate.approvedAt)}</div>
              <div><strong>Rejected:</strong> {formatOptionalDateTime(currentEstimate.rejectedAt)}</div>
              <div><strong>Decision source:</strong> {estimateDecisionSourceLabel(currentEstimate.decisionSource)}</div>
              <div><strong>Created by:</strong> {currentEstimate.createdByStaff?.name || currentEstimate.createdByStaff?.username || "-"}</div>
              <div><strong>Decided by:</strong> {currentEstimate.decisionByStaff?.name || currentEstimate.decisionByStaff?.username || "-"}</div>
              <div>
                <strong>Customer portal link:</strong>{" "}
                {currentEstimate.customerQuote ? (
                  <span className={currentEstimate.customerQuote.status === "ACTIVE" ? "status-badge status-complete" : "status-badge status-warning"}>
                    {workshopCustomerQuoteLinkStatusLabel(currentEstimate.customerQuote.status)}
                  </span>
                ) : (
                  "Not prepared"
                )}
              </div>
              <div><strong>Quote expires:</strong> {formatOptionalDateTime(currentEstimate.customerQuote?.expiresAt ?? null)}</div>
            </div>
            {currentEstimateQuoteUrl ? (
              <div className="actions-inline" style={{ marginTop: "12px" }}>
                <a href={currentEstimateQuoteUrl} target="_blank" rel="noreferrer" className="button-link button-link-compact">
                  Open Customer Portal
                </a>
                <code>{currentEstimateQuoteUrl}</code>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="restricted-panel" style={{ marginTop: "12px" }}>
            No saved quote snapshot yet. Save the current line set or send a quote for approval to capture the first version.
          </div>
        )}

        {payload && payload.lines.length === 0 ? (
          <div className="restricted-panel">
            Add labour and part lines below to create the first estimate for this job.
          </div>
        ) : null}

        <div className="restricted-panel" style={{ marginTop: "12px" }}>
          <div className="card-header-row">
            <div>
              <strong>Apply service template</strong>
              <div className="table-secondary">
                Use a common service preset to add ordinary labour and part lines, then keep editing the job as normal.
              </div>
            </div>
          </div>
          <div className="job-meta-grid" style={{ marginTop: "12px" }}>
            <label>
              Template
              <select
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
              >
                <option value="">No template selected</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="table-secondary">
              {loadingTemplates
                ? "Loading active service templates..."
                : selectedTemplate
                  ? "Optional part suggestions can be unticked before you apply this template."
                  : "Manager-maintained templates speed up common service quotes."}
            </div>
          </div>

          {selectedTemplate ? (
            <div style={{ marginTop: "12px" }}>
              <WorkshopServiceTemplatePreview
                template={selectedTemplate}
                selectedOptionalLineIds={selectedOptionalTemplateLineIds}
                onToggleOptionalLine={(lineId) =>
                  setSelectedOptionalTemplateLineIds((current) =>
                    current.includes(lineId)
                      ? current.filter((entry) => entry !== lineId)
                      : [...current, lineId],
                  )}
                actions={(
                  <button type="button" className="primary" onClick={() => void applyTemplate()} disabled={applyingTemplate}>
                    {applyingTemplate ? "Applying..." : "Apply Template"}
                  </button>
                )}
              />
            </div>
          ) : null}
        </div>

        <div className="table-wrap" style={{ marginTop: "12px" }}>
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Total</th>
                <th>Requested</th>
                <th>Decision</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {estimateHistory.length === 0 ? (
                <tr>
                  <td colSpan={6}>No estimate history yet.</td>
                </tr>
              ) : (
                estimateHistory.map((estimate) => (
                  <tr key={estimate.id}>
                    <td>
                      <div className="table-primary">v{estimate.version}</div>
                      <div className="table-secondary">
                        {estimate.isCurrent ? "Current quote" : `Superseded ${formatOptionalDateTime(estimate.supersededAt)}`}
                      </div>
                    </td>
                    <td>
                      <span className={workshopEstimateStatusClass(estimate.status)}>
                        {workshopEstimateStatusLabel(estimate.status)}
                      </span>
                    </td>
                    <td>{formatMoney(estimate.subtotalPence)}</td>
                    <td>{formatOptionalDateTime(estimate.requestedAt)}</td>
                    <td>{formatOptionalDateTime(estimate.approvedAt ?? estimate.rejectedAt)}</td>
                    <td>{formatOptionalDateTime(estimate.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Description</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!payload || payload.lines.length === 0 ? (
                <tr>
                  <td colSpan={6}>No estimate lines yet.</td>
                </tr>
              ) : (
                payload.lines.map((line) => {
                  const editable = editableByLineId[line.id] ?? {
                    description: line.description,
                    qty: line.qty,
                    unitPricePence: line.unitPricePence,
                  };

                  return (
                    <tr key={line.id}>
                      <td>{line.type}</td>
                      <td>
                        <input
                          value={editable.description}
                          onChange={(event) =>
                            setEditableByLineId((prev) => ({
                              ...prev,
                              [line.id]: {
                                ...editable,
                                description: event.target.value,
                              },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={1}
                          value={editable.qty}
                          onChange={(event) =>
                            setEditableByLineId((prev) => ({
                              ...prev,
                              [line.id]: {
                                ...editable,
                                qty: Number(event.target.value) || 1,
                              },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={editable.unitPricePence}
                          onChange={(event) =>
                            setEditableByLineId((prev) => ({
                              ...prev,
                              [line.id]: {
                                ...editable,
                                unitPricePence: Number(event.target.value) || 0,
                              },
                            }))
                          }
                        />
                      </td>
                      <td>{formatMoney((editable.qty || 0) * (editable.unitPricePence || 0))}</td>
                      <td>
                        <div className="actions-inline">
                          <button type="button" onClick={() => void saveLine(line.id)}>Save</button>
                          <button type="button" onClick={() => void removeLine(line.id)}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" id="workshop-job-conversation">
        <div className="card-header-row">
          <div>
            <h2>Customer Conversation</h2>
            <p className="muted-text">
              Use the portal thread for real customer messaging. Notes remain a separate operational record.
            </p>
          </div>
          {conversationPortalUrl ? (
            <a
              href={conversationPortalUrl}
              target="_blank"
              rel="noreferrer"
              className="button-link"
            >
              Open Customer Portal
            </a>
          ) : null}
        </div>

        <div className="restricted-panel info-panel" style={{ marginBottom: "12px" }}>
          <div className="job-meta-grid">
            <div>
              <strong>Portal access:</strong>{" "}
              {portalConversationAccess ? (
                <span
                  className={
                    portalConversationAccess.accessStatus === "ACTIVE"
                      ? "status-badge status-complete"
                      : portalConversationAccess.accessStatus === "SUPERSEDED"
                        ? "status-badge status-info"
                        : "status-badge status-warning"
                  }
                >
                  {portalConversationAccess.accessStatus}
                </span>
              ) : (
                "Checking..."
              )}
            </div>
            <div>
              <strong>Customer can reply:</strong>{" "}
              {portalConversationAccess?.canCustomerReply ? "Yes" : "No"}
            </div>
            <div>
              <strong>Thread messages:</strong> {conversationPayload?.conversation.messageCount ?? 0}
            </div>
            <div>
              <strong>Last message:</strong>{" "}
              {formatOptionalDateTime(conversationPayload?.conversation.lastMessageAt ?? null)}
            </div>
          </div>
          {!portalConversationAccess || portalConversationAccess.accessStatus === "UNAVAILABLE" ? (
            <p className="muted-text" style={{ marginTop: "10px" }}>
              This job does not currently have an active customer portal link. Staff messages will still be recorded,
              but customer alerts will be skipped until a portal link exists.
            </p>
          ) : null}
          {portalConversationAccess?.accessStatus === "EXPIRED" ? (
            <p className="muted-text" style={{ marginTop: "10px" }}>
              The most recent portal link has expired. The conversation is still recorded, but customers cannot reply
              until the shop prepares a fresh portal link.
            </p>
          ) : null}
        </div>

        <form
          className="note-form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void sendConversationMessage();
          }}
        >
          <label className="note-form-wide">
            New customer message
            <textarea
              value={conversationDraft}
              onChange={(event) => setConversationDraft(event.target.value)}
              placeholder="Write a customer-safe update that will appear in the workshop portal."
            />
          </label>
          <div className="actions-inline">
            <button
              type="submit"
              className="primary"
              disabled={sendingConversation || !conversationDraft.trim()}
            >
              {sendingConversation ? "Sending..." : "Send Portal Message"}
            </button>
          </div>
        </form>

        <div className="notes-panel" style={{ marginTop: "12px" }}>
          <h3>Thread history</h3>
          {conversationLoading ? <p>Loading conversation...</p> : null}
          {!conversationLoading && conversationMessages.length === 0 ? (
            <p className="muted-text">No customer conversation messages yet.</p>
          ) : (
            <div className="conversation-thread">
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
                      {message.direction === "OUTBOUND" ? "Sent by workshop" : "Customer reply"}
                    </span>
                    <span className="table-secondary">
                      {formatOptionalDateTime(message.sentAt ?? message.receivedAt ?? message.createdAt)}
                    </span>
                  </div>
                  <p>{message.body}</p>
                  <div className="table-secondary">
                    {message.direction === "OUTBOUND"
                      ? message.authorStaff?.name || message.authorStaff?.username || "Workshop team"
                      : "Customer portal"}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="card" id="workshop-job-notifications">
        <div className="card-header-row">
          <div>
            <h2>Notifications</h2>
            <p className="muted-text">
              Review workshop notification attempts here and resend the current quote or collection email when the job state still supports it.
            </p>
          </div>
          <div className="actions-inline">
            <button
              type="button"
              onClick={() => void resendNotification("QUOTE_READY")}
              disabled={!canResendQuoteNotification || resendingNotificationType !== null}
            >
              {resendingNotificationType === "QUOTE_READY"
                ? "Resending Quote Email..."
                : "Resend Quote Email"}
            </button>
            <button
              type="button"
              onClick={() => void resendNotification("JOB_READY_FOR_COLLECTION")}
              disabled={!canResendReadyNotification || resendingNotificationType !== null}
            >
              {resendingNotificationType === "JOB_READY_FOR_COLLECTION"
                ? "Resending Collection Email..."
                : "Resend Collection Email"}
            </button>
          </div>
        </div>

        <div className="restricted-panel info-panel" style={{ marginBottom: "12px" }}>
          Smart delivery now chooses one primary channel with fallback only when needed, so this history shows quote alerts, collection alerts, and portal-message alerts with their final delivery path plus any skipped or failed fallback attempts. Staff resend controls remain email-first: quote email resend stays available while a current quote is awaiting approval, and collection email resend stays available while the bike is ready for collection.
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Notification</th>
                <th>Attempted</th>
                <th>Status</th>
                <th>Recipient</th>
                <th>Summary</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {notificationsLoading ? (
                <tr>
                  <td colSpan={6}>Loading notifications...</td>
                </tr>
              ) : notifications.length === 0 ? (
                <tr>
                  <td colSpan={6}>No workshop notifications have been attempted for this job yet.</td>
                </tr>
              ) : (
                notifications.map((notification) => (
                  <tr key={notification.id}>
                    <td>
                      <div className="table-primary">
                        {workshopNotificationEventLabel(notification.eventType)}
                      </div>
                      <div className="table-secondary">
                        {notificationChannelSummaryLabel(notification)}
                      </div>
                    </td>
                    <td>{formatOptionalDateTime(notification.createdAt)}</td>
                    <td>
                      <span
                        className={workshopNotificationDeliveryStatusClass(
                          notification.deliveryStatus,
                        )}
                      >
                        {workshopNotificationDeliveryStatusLabel(
                          notification.deliveryStatus,
                        )}
                      </span>
                    </td>
                    <td>{notificationRecipientLabel(notification)}</td>
                    <td>{notification.subject || notification.messageSummary || "-"}</td>
                    <td>
                      {notification.reasonMessage ||
                        (notification.deliveryStatus === "SENT"
                          ? `Sent ${formatOptionalDateTime(
                              notification.sentAt || notification.createdAt,
                            )}`
                          : notification.deliveryStatus === "PENDING"
                            ? "Delivery is still being recorded."
                            : "-")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" id="workshop-job-attachments">
        <div className="card-header-row">
          <div>
            <h2>Attachments &amp; Photos</h2>
            <p className="muted-text">
              Upload job photos or PDFs here. Mark customer-safe files as customer visible so they appear in the secure portal.
            </p>
          </div>
          <div className="table-secondary">
            {attachments.length} attachment{attachments.length === 1 ? "" : "s"}
          </div>
        </div>

        <form
          className="note-form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void uploadAttachment();
          }}
        >
          <label className="note-form-wide">
            File
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={(event) => setSelectedAttachmentFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Visibility
            <select
              value={attachmentVisibility}
              onChange={(event) =>
                setAttachmentVisibility(event.target.value as WorkshopAttachmentRecord["visibility"])
              }
            >
              <option value="INTERNAL">Internal only</option>
              <option value="CUSTOMER">Customer visible</option>
            </select>
          </label>
          <div className="actions-inline">
            <button
              type="submit"
              className="primary"
              disabled={!selectedAttachmentFile || uploadingAttachment}
            >
              {uploadingAttachment ? "Uploading..." : "Upload Attachment"}
            </button>
          </div>
        </form>

        <p className="muted-text" style={{ marginTop: "8px" }}>
          Supported files: PNG, JPEG, WEBP, or PDF up to 10MB.
        </p>

        {attachmentsLoading ? <p>Loading attachments...</p> : null}
        {!attachmentsLoading && attachments.length === 0 ? (
          <p className="muted-text">No workshop attachments have been added yet.</p>
        ) : null}

        {!attachmentsLoading && attachments.length > 0 ? (
          <div className="attachment-grid">
            {attachments.map((attachment) => (
              <article key={attachment.id} className="attachment-card">
                <div className="note-card-header">
                  <span
                    className={
                      attachment.visibility === "CUSTOMER"
                        ? "status-badge status-complete"
                        : "status-badge"
                    }
                  >
                    {attachment.visibility === "CUSTOMER" ? "Customer visible" : "Internal only"}
                  </span>
                  <span className="table-secondary">
                    {formatOptionalDateTime(attachment.createdAt)}
                  </span>
                </div>

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
                  {formatFileSize(attachment.fileSizeBytes)} ·{" "}
                  {attachment.uploadedByStaff?.name || attachment.uploadedByStaff?.username || "Workshop team"}
                </div>
                <div className="actions-inline">
                  <a href={attachment.filePath} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  <button
                    type="button"
                    onClick={() => void deleteAttachment(attachment.id)}
                    disabled={deletingAttachmentId === attachment.id}
                  >
                    {deletingAttachmentId === attachment.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="card" id="workshop-job-parts">
        <div className="card-header-row">
          <div>
            <h2>Parts Allocation</h2>
            <p className="muted-text">
              Reserve parts against estimate lines, then consume them when they are fitted. Consumed and returned parts create the workshop stock movements visible on the linked inventory item.
            </p>
          </div>
          <div className="table-secondary">
            {partsLoading ? "Refreshing parts..." : partsOverview?.stockLocation.name ?? "-"}
          </div>
        </div>

        {partsOverview ? (
          <>
            <div className="metric-grid">
              <div className="metric-card">
                <span className="metric-label">Required</span>
                <strong className="metric-value">{partsOverview.summary.requiredQty}</strong>
                <span className="table-secondary">Estimate part quantity</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Allocated</span>
                <strong className="metric-value">{partsOverview.summary.allocatedQty}</strong>
                <span className="table-secondary">{plannedPartRecords.length} planned records</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Consumed</span>
                <strong className="metric-value">{partsOverview.summary.consumedQty}</strong>
                <span className="table-secondary">{usedPartRecords.length} used records</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Used Value</span>
                <strong className="metric-value">{formatMoney(partsPayload?.totals.partsUsedTotalPence ?? 0)}</strong>
                <span className="table-secondary">Tracked parts consumed on this job</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Parts Status</span>
                <strong className="metric-value">
                  <span className={partsStatusClass(partsOverview.summary.partsStatus)}>
                    {partsOverview.summary.partsStatus}
                  </span>
                </strong>
                <span className="table-secondary">
                  Missing {partsOverview.summary.missingQty}, outstanding {partsOverview.summary.outstandingQty}
                </span>
              </div>
            </div>

            {partsOverview.summary.partsStatus === "SHORT" ? (
              <div className="restricted-panel warning-panel">
                Parts are short for this job. The workshop board will surface this job in the Waiting Parts bucket,
                even if the raw workshop status has not been manually changed.
              </div>
            ) : partsOverview.summary.partsStatus === "UNALLOCATED" ? (
              <div className="restricted-panel info-panel">
                Parts are still unallocated for this job, but current stock suggests they can be reserved now.
              </div>
            ) : (
              <div className="success-panel">Required workshop parts are fully allocated or consumed.</div>
            )}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Part Requirement</th>
                    <th>Required</th>
                    <th>Allocated</th>
                    <th>Consumed</th>
                    <th>Outstanding</th>
                    <th>Missing</th>
                    <th>On Hand</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {partsOverview.requirements.length === 0 ? (
                    <tr>
                      <td colSpan={8}>No part estimate lines yet.</td>
                    </tr>
                  ) : (
                    partsOverview.requirements.map((requirement) => {
                      const reserveQty = Math.min(
                        requirement.outstandingQty,
                        requirement.availableToAllocate,
                      );

                      return (
                        <tr key={requirement.variantId}>
                          <td>
                            <strong>{requirement.productName}</strong>
                            <div className="table-secondary">
                              {requirement.variantName || requirement.sku} · {requirement.sku}
                            </div>
                            <div className="table-secondary">Estimate value {formatMoney(requirement.estimateValuePence)}</div>
                            <div className="table-secondary">
                              <Link to={`/inventory/${requirement.variantId}`}>Open inventory movement detail</Link>
                            </div>
                          </td>
                          <td>{requirement.requiredQty}</td>
                          <td>{requirement.allocatedQty}</td>
                          <td>{requirement.consumedQty}</td>
                          <td>{requirement.outstandingQty}</td>
                          <td>
                            <span className={partsStatusClass(requirement.partsStatus)}>
                              {requirement.missingQty}
                            </span>
                          </td>
                          <td>{requirement.stockOnHand}</td>
                          <td>
                            {reserveQty > 0 ? (
                              <button type="button" onClick={() => void reserveRequiredParts(requirement)}>
                                Reserve {reserveQty}
                              </button>
                            ) : (
                              <span className="muted-text">
                                {requirement.partsStatus === "SHORT" ? "No stock to reserve" : "Covered"}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Job Part Record</th>
                    <th>Status</th>
                    <th>Qty</th>
                    <th>Location</th>
                    <th>Value</th>
                    <th>Stock Effect</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {!partsPayload || partsPayload.parts.length === 0 ? (
                    <tr>
                      <td colSpan={7}>No workshop part allocations yet.</td>
                    </tr>
                  ) : (
                    partsPayload.parts.map((part) => (
                      <tr key={part.id}>
                        <td>
                          <strong>{part.productName}</strong>
                          <div className="table-secondary">
                            {part.variantName || part.sku} · {part.sku}
                          </div>
                        </td>
                        <td>
                          <span className={part.status === "USED" ? "status-badge status-complete" : part.status === "PLANNED" ? "status-badge" : "status-badge status-info"}>
                            {part.status}
                          </span>
                        </td>
                        <td>{part.quantity}</td>
                        <td>
                          <div>{part.stockLocationName}</div>
                          <div className="table-secondary">{new Date(part.updatedAt).toLocaleString()}</div>
                        </td>
                        <td>{formatMoney(part.lineTotalPence)}</td>
                        <td>
                          <div className="table-primary">
                            {part.status === "USED"
                              ? `-${part.quantity} from ${part.stockLocationName}`
                              : part.status === "RETURNED"
                                ? `+${part.quantity} back into ${part.stockLocationName}`
                                : "Reserved only, not yet consumed"}
                          </div>
                          <div className="table-secondary">
                            <Link to={`/inventory/${part.variantId}`}>Open inventory history</Link>
                          </div>
                        </td>
                        <td>
                          <div className="actions-inline">
                            {part.status === "PLANNED" ? (
                              <>
                                <button type="button" onClick={() => void markPartStatus(part.id, "USED")}>
                                  Consume
                                </button>
                                <button type="button" onClick={() => void removeReservedPart(part.id)}>
                                  Unreserve
                                </button>
                              </>
                            ) : null}
                            {part.status === "USED" ? (
                              <button type="button" onClick={() => void markPartStatus(part.id, "RETURNED")}>
                                Return
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>Loading parts allocation...</p>
        )}
      </section>

      <section className="card" id="workshop-job-progress">
        <div className="card-header-row">
          <div>
            <h2>Progress & Notes</h2>
            <p className="muted-text">
              Use notes for internal workflow context and quote-specific customer notes. Use the conversation panel above for direct customer messaging.
            </p>
          </div>
        </div>

        <form className="note-form-grid" onSubmit={addNote}>
          <label className="note-form-wide">
            Note
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="Add internal note or customer-visible quote note"
            />
          </label>
          <label>
            Visibility
            <select
              value={noteVisibility}
              onChange={(event) => setNoteVisibility(event.target.value as "INTERNAL" | "CUSTOMER")}
            >
              <option value="INTERNAL">Internal</option>
              {canPostCustomerNotes ? <option value="CUSTOMER">Customer-visible</option> : null}
            </select>
          </label>
          <div className="actions-inline">
            <button type="submit" className="primary" disabled={savingNote}>
              {savingNote ? "Saving..." : "Add Note"}
            </button>
          </div>
        </form>

        {!canPostCustomerNotes ? (
          <p className="muted-text">Customer-visible quote notes require MANAGER+.</p>
        ) : null}

        <div className="notes-grid">
          <section className="notes-panel">
            <h3>Customer-visible Notes</h3>
            {notesLoading ? <p>Loading notes...</p> : null}
            {customerNotes.length === 0 ? (
              <p className="muted-text">No customer-visible quote notes yet.</p>
            ) : (
              customerNotes.map((note) => (
                <article key={note.id} className="note-card">
                  <div className="note-card-header">
                    <span className="status-badge status-info">{note.visibility}</span>
                    <span className="table-secondary">{new Date(note.createdAt).toLocaleString()}</span>
                  </div>
                  <p>{note.note}</p>
                  <div className="table-secondary">
                    {note.authorStaff?.name || note.authorStaff?.username || "Unknown staff"}
                  </div>
                </article>
              ))
            )}
          </section>

          <section className="notes-panel">
            <h3>Internal Notes</h3>
            {notesLoading ? <p>Loading notes...</p> : null}
            {internalNotes.length === 0 ? (
              <p className="muted-text">No internal notes yet.</p>
            ) : (
              internalNotes.map((note) => (
                <article key={note.id} className="note-card">
                  <div className="note-card-header">
                    <span className="status-badge">{note.visibility}</span>
                    <span className="table-secondary">{new Date(note.createdAt).toLocaleString()}</span>
                  </div>
                  <p>{note.note}</p>
                  <div className="table-secondary">
                    {note.authorStaff?.name || note.authorStaff?.username || "Unknown staff"}
                  </div>
                </article>
              ))
            )}
          </section>
        </div>
      </section>

      <section className="card" id="workshop-job-build">
        <h2>Add Labour</h2>
        <div className="filter-row">
          <label className="grow">
            Description
            <input
              value={labourDescription}
              onChange={(event) => setLabourDescription(event.target.value)}
            />
          </label>
          <label>
            Qty
            <input
              type="number"
              min={1}
              value={labourQty}
              onChange={(event) => setLabourQty(Number(event.target.value) || 1)}
            />
          </label>
          <label>
            Unit (p)
            <input
              type="number"
              min={0}
              value={labourPrice}
              onChange={(event) => setLabourPrice(Number(event.target.value) || 0)}
            />
          </label>
          <button type="button" onClick={addLabourLine}>Add Labour</button>
        </div>

        <h2>Add Part</h2>
        <div className="filter-row">
          <label className="grow">
            Search Product
            <input
              value={partSearch}
              onChange={(event) => setPartSearch(event.target.value)}
              placeholder="name / barcode / sku"
            />
          </label>
          <label>
            Qty
            <input
              type="number"
              min={1}
              value={partQty}
              onChange={(event) => setPartQty(Number(event.target.value) || 1)}
            />
          </label>
          <label>
            Unit (p)
            <input
              type="number"
              min={0}
              value={partPrice}
              onChange={(event) => setPartPrice(Number(event.target.value) || 0)}
            />
          </label>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>SKU</th>
                <th>Price</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {partResults.length === 0 ? (
                <tr>
                  <td colSpan={4}>No part results.</td>
                </tr>
              ) : (
                partResults.map((product) => (
                  <tr key={product.id}>
                    <td>{product.name}</td>
                    <td>{product.sku}</td>
                    <td>{formatMoney(product.pricePence)}</td>
                    <td>
                      <button type="button" onClick={() => void addPartLine(product)}>
                        Add Part
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
