import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { useOpenPosWithContext, type PosLineItem, type SaleContext } from "../features/pos/posContext";
import {
  workshopExecutionStatusClass,
  workshopExecutionStatusLabel,
  workshopRawStatusClass,
  workshopRawStatusLabel,
} from "../features/workshop/status";
import {
  workshopCustomerQuoteLinkStatusLabel,
  workshopEstimateStatusClass,
  workshopEstimateStatusLabel,
} from "../features/workshop/estimateStatus";
import {
  workshopNotificationDeliveryStatusClass,
  workshopNotificationDeliveryStatusLabel,
  workshopNotificationEventLabel,
} from "../features/workshop/notificationStatus";
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

type WorkshopNotificationRecord = {
  id: string;
  workshopJobId: string;
  workshopEstimateId: string | null;
  channel: "EMAIL";
  eventType: "QUOTE_READY" | "JOB_READY_FOR_COLLECTION";
  deliveryStatus: "PENDING" | "SENT" | "SKIPPED" | "FAILED";
  recipientEmail: string | null;
  subject: string | null;
  messageSummary: string | null;
  reasonCode: string | null;
  reasonMessage: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
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

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

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

const notificationActionLabel = (
  eventType: WorkshopNotificationRecord["eventType"],
) =>
  eventType === "QUOTE_READY" ? "quote email" : "ready-for-collection email";

const getWorkflowGuidance = (input: {
  rawStatus: string;
  partsStatus: WorkshopPartsStatus | undefined;
  hasSale: boolean;
  hasBasket: boolean;
}) => {
  if (input.rawStatus === "WAITING_FOR_APPROVAL") {
    return "Quote approval is still pending. Pause bench work until the customer approves or the quote is revised.";
  }

  if (input.rawStatus === "WAITING_FOR_PARTS" || input.partsStatus === "SHORT") {
    return "This job is blocked on parts. Reserve stock or receive missing parts before pushing it forward.";
  }

  if (input.rawStatus === "BOOKING_MADE") {
    return "The bike is checked in and ready to move onto the bench or into quote approval.";
  }

  if (input.rawStatus === "BIKE_ARRIVED" || input.rawStatus === "APPROVED" || input.rawStatus === "ON_HOLD") {
    return "Continue work, update notes as progress changes, and mark the bike ready when the bench work is complete.";
  }

  if (input.rawStatus === "BIKE_READY") {
    if (input.hasSale) {
      return "A sale is already linked. Open the sale to collect payment and finish the handover.";
    }
    if (input.hasBasket) {
      return "A POS handoff basket is ready. Open it to complete collection at the counter.";
    }
    return "Workshop work is finished. Send the job to POS to create the collection handoff.";
  }

  if (input.rawStatus === "COMPLETED") {
    return "This job has already been collected through POS checkout.";
  }

  if (input.rawStatus === "CANCELLED") {
    return "This job is cancelled and is no longer part of the active workshop queue.";
  }

  return "Use the status actions below to keep the workshop board aligned with bench progress.";
};

const toRawStatus = (job: WorkshopJobResponse["job"] | null | undefined) => {
  if (!job) {
    return "";
  }

  if (job.rawStatus) {
    return job.rawStatus;
  }

  switch (job.status) {
    case "BOOKED":
      return "BOOKING_MADE";
    case "READY":
      return "BIKE_READY";
    case "COLLECTED":
    case "CLOSED":
      return "COMPLETED";
    case "IN_PROGRESS":
      return "BIKE_ARRIVED";
    default:
      return job.status;
  }
};

const canPersistApprovalStatus = (status: string) =>
  ["BOOKING_MADE", "BIKE_ARRIVED", "WAITING_FOR_APPROVAL", "APPROVED", "ON_HOLD"].includes(status);

const getStageActions = (status: string): Array<{ label: string; value: string }> => {
  switch (status) {
    case "BOOKING_MADE":
      return [
        { label: "Start Work", value: "IN_PROGRESS" },
        { label: "Cancel", value: "CANCELLED" },
      ];
    case "BIKE_ARRIVED":
    case "APPROVED":
    case "ON_HOLD":
      return [
        { label: "Ready for Collection", value: "READY" },
        { label: "Cancel", value: "CANCELLED" },
      ];
    case "WAITING_FOR_APPROVAL":
      return [{ label: "Cancel", value: "CANCELLED" }];
    default:
      return [];
  }
};

export const WorkshopJobPage = () => {
  const { id } = useParams<{ id: string }>();
  const openPosWithContext = useOpenPosWithContext();
  const { user } = useAuth();
  const { success, error } = useToasts();

  const [payload, setPayload] = useState<WorkshopJobResponse | null>(null);
  const [notes, setNotes] = useState<WorkshopNote[]>([]);
  const [notifications, setNotifications] = useState<WorkshopNotificationRecord[]>([]);
  const [partsPayload, setPartsPayload] = useState<WorkshopPartsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [partsLoading, setPartsLoading] = useState(false);
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

  useEffect(() => {
    void Promise.all([loadJob(), loadNotes(), loadNotifications(), loadParts()]);
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
    if (!id) {
      return;
    }

    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(id)}/status`, { status: nextStatus });
      success("Workflow status updated");
      await Promise.all([loadJob(), loadNotifications()]);
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : "Failed to update status";
      error(message);
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
        throw new Error("Customer quote link was not returned.");
      }

      const publicUrl = toPublicAppUrl(publicPath);
      await navigator.clipboard.writeText(publicUrl);
      success(
        response.idempotent
          ? "Customer quote link copied"
          : "Customer quote link prepared and copied",
      );
      await Promise.all([loadJob(), loadNotifications()]);
    } catch (quoteError) {
      const message = quoteError instanceof Error ? quoteError.message : "Failed to prepare customer quote link";
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
  const rawStatus = useMemo(() => toRawStatus(payload?.job), [payload?.job]);
  const currentEstimate = payload?.currentEstimate ?? null;
  const estimateHistory = payload?.estimateHistory ?? [];
  const canResendQuoteNotification = currentEstimate?.status === "PENDING_APPROVAL";
  const canResendReadyNotification = rawStatus === "BIKE_READY";
  const currentEstimateQuoteUrl = currentEstimate?.customerQuote?.publicPath
    ? toPublicAppUrl(currentEstimate.customerQuote.publicPath)
    : null;
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

  const stageActions = useMemo(() => getStageActions(rawStatus), [rawStatus]);

  const customerNotes = useMemo(
    () => notes.filter((note) => note.visibility === "CUSTOMER"),
    [notes],
  );
  const internalNotes = useMemo(
    () => notes.filter((note) => note.visibility === "INTERNAL"),
    [notes],
  );
  const latestCustomerNote = customerNotes[0] ?? null;
  const latestInternalNote = internalNotes[0] ?? null;
  const workflowGuidance = useMemo(
    () =>
      getWorkflowGuidance({
        rawStatus,
        partsStatus: partsOverview?.summary.partsStatus,
        hasSale: Boolean(payload?.job.sale),
        hasBasket: Boolean(payload?.job.finalizedBasketId),
      }),
    [partsOverview?.summary.partsStatus, payload?.job.finalizedBasketId, payload?.job.sale, rawStatus],
  );
  const collectionSummary = useMemo(() => {
    if (!payload) {
      return null;
    }

    if (payload.job.sale) {
      return `Sale ${payload.job.sale.id.slice(0, 8)} linked for ${formatMoney(payload.job.sale.totalPence)}.`;
    }

    if (payload.job.finalizedBasketId) {
      return `POS basket ${payload.job.finalizedBasketId.slice(0, 8)} is ready for collection handoff.`;
    }

    if (rawStatus === "BIKE_READY") {
      return "Ready for collection, but the POS handoff has not been opened yet.";
    }

    return null;
  }, [payload, rawStatus]);

  if (!id) {
    return <div className="page-shell"><p>Missing workshop job id.</p></div>;
  }

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <h1>Workshop Job {id.slice(0, 8)}</h1>
          <div className="actions-inline">
            {payload?.job.bike ? (
              <Link to={`/customers/bikes/${payload.job.bike.id}`} className="button-link">
                Bike History
              </Link>
            ) : null}
            {payload && payload.job.status !== "CLOSED" && payload.job.status !== "CANCELLED" ? (
              <button type="button" className="primary" onClick={openPosHandoff}>
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
            <div className="job-meta-grid">
              <div>
                <strong>Execution Status:</strong>{" "}
                <span className={workshopExecutionStatusClass(payload.job.status, rawStatus)}>
                  {workshopExecutionStatusLabel(payload.job.status)}
                </span>
              </div>
              <div>
                <strong>Workflow Detail:</strong>{" "}
                <span className={workshopRawStatusClass(rawStatus)}>{workshopRawStatusLabel(rawStatus)}</span>
              </div>
              <div><strong>Next Step:</strong> {workflowGuidance}</div>
              <div>
                <strong>Quote Status:</strong>{" "}
                <span className={workshopEstimateStatusClass(currentEstimate?.status)}>
                  {workshopEstimateStatusLabel(currentEstimate?.status)}
                </span>
              </div>
              <div>
                <strong>Customer Quote:</strong>{" "}
                {currentEstimate?.customerQuote ? (
                  <span className={currentEstimate.customerQuote.status === "ACTIVE" ? "status-badge status-complete" : "status-badge status-warning"}>
                    {workshopCustomerQuoteLinkStatusLabel(currentEstimate.customerQuote.status)}
                  </span>
                ) : (
                  "Not prepared"
                )}
              </div>
              <div><strong>Legacy Status Code:</strong> {rawStatus || "-"}</div>
              <div>
                <strong>Parts State:</strong>{" "}
                <span className={partsStatusClass(partsOverview?.summary.partsStatus)}>
                  {partsOverview?.summary.partsStatus ?? "OK"}
                </span>
              </div>
              <div><strong>Customer:</strong> {payload.job.customerName || "-"}</div>
              <div><strong>Bike:</strong> {payload.job.bikeDescription || "-"}</div>
              <div>
                <strong>Linked Bike Record:</strong>{" "}
                {payload.job.bike ? (
                  <Link to={`/customers/bikes/${payload.job.bike.id}`}>{payload.job.bike.displayName}</Link>
                ) : (
                  "No linked bike record"
                )}
              </div>
              <div><strong>Assigned Technician:</strong> {payload.job.assignedStaffName || "Unassigned"}</div>
              <div><strong>Scheduled:</strong> {formatOptionalDateTime(payload.job.scheduledDate)}</div>
              <div><strong>Check-in Notes:</strong> {payload.job.notes || "-"}</div>
              <div><strong>Collection Handoff:</strong> {collectionSummary ?? "Not ready for collection yet."}</div>
              <div><strong>Updated:</strong> {new Date(payload.job.updatedAt).toLocaleString()}</div>
              <div>
                <strong>Parts Location:</strong> {partsOverview?.stockLocation.name ?? "-"}
              </div>
            </div>

            <div className="action-wrap" style={{ marginBottom: "10px" }}>
              {stageActions.map((action) => (
                <button key={action.value} type="button" onClick={() => void updateStageStatus(action.value)}>
                  {action.label}
                </button>
              ))}
              {canPersistApprovalStatus(rawStatus) ? (
                <>
                  <button
                    type="button"
                    onClick={() => void saveEstimateSnapshot()}
                    disabled={savingEstimate || payload.lines.length === 0}
                  >
                    {savingEstimate ? "Saving Snapshot..." : "Save Quote Snapshot"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateApprovalStatus("WAITING_FOR_APPROVAL")}
                    disabled={currentEstimate?.status === "PENDING_APPROVAL" || payload.lines.length === 0}
                  >
                    Send Quote
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateApprovalStatus("APPROVED")}
                    disabled={currentEstimate?.status === "APPROVED" || payload.lines.length === 0}
                  >
                    Mark Quote Approved
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateApprovalStatus("REJECTED")}
                    disabled={currentEstimate?.status === "REJECTED" || payload.lines.length === 0}
                  >
                    Mark Quote Rejected
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
                        ? "Copy Customer Quote Link"
                        : "Prepare Customer Quote Link"}
                  </button>
                </>
              ) : null}
              {stageActions.length === 0 && !canPersistApprovalStatus(rawStatus) ? (
                <span className="muted-text">No manual workflow status changes are available for this job right now.</span>
              ) : null}
            </div>

            {latestInternalNote || latestCustomerNote ? (
              <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
                <div className="job-meta-grid">
                  <div>
                    <strong>Latest internal note:</strong>{" "}
                    {latestInternalNote ? truncateText(latestInternalNote.note) : "No internal notes yet."}
                  </div>
                  <div>
                    <strong>Latest customer note:</strong>{" "}
                    {latestCustomerNote ? truncateText(latestCustomerNote.note) : "No customer-visible notes yet."}
                  </div>
                </div>
              </div>
            ) : null}

            {rawStatus === "BIKE_READY" ? (
              <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
                Collection is completed through POS checkout. Use the POS handoff button above instead of
                manually marking the job collected.
              </div>
            ) : null}

            {collectionSummary ? (
              <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
                <strong>Collection Summary</strong>
                <div className="job-meta-grid" style={{ marginTop: "8px" }}>
                  <div><strong>Estimate total:</strong> {formatMoney(subtotalPence)}</div>
                  <div><strong>Parts fitted:</strong> {partsOverview?.summary.consumedQty ?? 0}</div>
                  <div><strong>Outstanding parts:</strong> {partsOverview?.summary.outstandingQty ?? 0}</div>
                  <div>
                    <strong>Customer note for pickup:</strong>{" "}
                    {latestCustomerNote ? truncateText(latestCustomerNote.note) : "No customer-visible note recorded."}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="card">
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

      <section className="card">
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
                <strong>Customer quote link:</strong>{" "}
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
                  Open Customer Quote Page
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

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Notifications</h2>
            <p className="muted-text">
              Review workshop email attempts here and resend the current quote or collection email when the job state still supports it.
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
          Quote email resend stays available while a current quote is awaiting approval. Collection email resend stays available while the bike is ready for collection.
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
                  <td colSpan={6}>No workshop emails have been attempted for this job yet.</td>
                </tr>
              ) : (
                notifications.map((notification) => (
                  <tr key={notification.id}>
                    <td>
                      <div className="table-primary">
                        {workshopNotificationEventLabel(notification.eventType)}
                      </div>
                      <div className="table-secondary">
                        {notification.channel === "EMAIL" ? "Email" : notification.channel}
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
                    <td>{notification.recipientEmail || "No customer email"}</td>
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

      <section className="card">
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

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Progress & Notes</h2>
            <p className="muted-text">
              Use internal notes for staff context. Use customer-visible notes for quote or approval messaging.
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

      <section className="card">
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
