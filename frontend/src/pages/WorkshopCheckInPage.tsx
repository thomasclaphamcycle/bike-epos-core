import { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../api/client";
import { WorkshopCommercialInsightsPanel } from "../components/WorkshopCommercialInsightsPanel";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { WorkshopServiceTemplatePreview } from "../components/WorkshopServiceTemplatePreview";
import {
  formatWorkshopTemplateMoney,
  getDefaultSelectedOptionalLineIds,
  type WorkshopServiceTemplateApplyResponse,
  type WorkshopServiceTemplate,
  type WorkshopServiceTemplatesResponse,
} from "../features/workshop/serviceTemplates";
import { type WorkshopCommercialInsights } from "../features/workshop/commercialInsights";

type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

type CustomerSearchResponse = {
  customers: CustomerRow[];
};

type CustomerResponse = CustomerRow & {
  notes: string | null;
};

type CustomerBikeRecord = {
  id: string;
  customerId: string;
  label: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  bikeType: string | null;
  colour: string | null;
  frameNumber: string | null;
  serialNumber: string | null;
  registrationNumber: string | null;
  notes: string | null;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string | null;
  serviceSummary?: {
    linkedJobCount: number;
    openJobCount: number;
    completedJobCount: number;
    firstJobAt: string | null;
    latestJobAt: string | null;
    latestCompletedAt: string | null;
  };
  commercialInsights?: WorkshopCommercialInsights;
};

type CustomerBikesResponse = {
  customerId: string;
  bikes: CustomerBikeRecord[];
};

type CustomerBikeWorkshopStartContextResponse = {
  customer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  };
  bike: CustomerBikeRecord;
  defaults: {
    customerId: string;
    customerName: string;
    bikeId: string;
    bikeDescription: string;
    status: "BOOKED";
  };
  startPath: string;
};

const stepTitles = [
  "Customer",
  "Bike",
  "Services",
  "Review",
] as const;

const QUICK_PROBLEM_WORK_CHIPS = [
  {
    label: "Puncture",
    text: "Puncture repair requested",
  },
  {
    label: "Brake issue",
    text: "Check and adjust brakes",
  },
  {
    label: "Gear issue",
    text: "Check and adjust gears",
  },
  {
    label: "Service due",
    text: "Service due / service requested",
  },
  {
    label: "E-bike",
    text: "E-bike diagnostic / service request",
  },
] as const;

const REVIEW_ACTION_PILLS = [
  {
    key: "printJobTicket",
    label: "Print Job Ticket",
  },
  {
    key: "sendCustomerConfirmationEmail",
    label: "Send customer confirmation (email)",
  },
] as const;

type ReviewActionKey = (typeof REVIEW_ACTION_PILLS)[number]["key"];

type WorkshopReviewActionState = Record<ReviewActionKey, boolean>;

const BIKE_TYPE_LABELS: Record<string, string> = {
  ROAD: "Road",
  MTB: "MTB",
  E_BIKE: "E-bike",
  HYBRID: "Hybrid",
  GRAVEL: "Gravel",
  COMMUTER: "Commuter",
  BMX: "BMX",
  KIDS: "Kids",
  CARGO: "Cargo",
  FOLDING: "Folding",
  OTHER: "Other",
};

const buildCheckInNotes = (input: {
  problemWork: string;
  additionalNotes: string;
}) => {
  const rows = [
    input.problemWork.trim() ? `Problem / Work: ${input.problemWork.trim()}` : "",
    input.additionalNotes.trim() ? `Additional notes: ${input.additionalNotes.trim()}` : "",
  ].filter(Boolean);

  return rows.join("\n");
};

const buildBikeDraftDisplayName = (input: {
  label: string;
  make: string;
  model: string;
  colour: string;
  frameNumber: string;
  serialNumber: string;
  registrationNumber: string;
}) => {
  const label = input.label.trim();
  const makeModel = [input.make.trim(), input.model.trim()].filter(Boolean).join(" ");
  const colour = input.colour.trim();
  const identifier = input.registrationNumber.trim() || input.serialNumber.trim() || input.frameNumber.trim();
  const primary = [label, makeModel].filter(Boolean).join(" · ");

  if (primary) {
    return [primary, colour, identifier].filter(Boolean).join(" | ");
  }

  const fallback = [makeModel, colour, identifier].filter(Boolean).join(" | ");
  return fallback || "New bike record";
};

const normalizeBikeText = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const formatBikeTypeLabel = (bikeType: string | null | undefined) => {
  const normalized = normalizeBikeText(bikeType);
  if (!normalized) {
    return null;
  }

  return BIKE_TYPE_LABELS[normalized] ?? normalized
    .toLocaleLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toLocaleUpperCase());
};

const buildBikeInlineSummary = (bike: CustomerBikeRecord) => {
  const makeModel = [normalizeBikeText(bike.make), normalizeBikeText(bike.model)]
    .filter(Boolean)
    .join(" ");
  const summary = [
    makeModel || normalizeBikeText(bike.label),
    formatBikeTypeLabel(bike.bikeType),
    normalizeBikeText(bike.colour),
  ].filter(Boolean);

  return summary.join(" · ") || bike.displayName;
};

const formatDaysAgo = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return null;
  }

  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) {
    return "today";
  }
  if (days === 1) {
    return "1 day ago";
  }
  return `${days} days ago`;
};

const buildBikeInlineMeta = (bike: CustomerBikeRecord) => {
  const detail = normalizeBikeText(bike.label)
    ?? normalizeBikeText(bike.registrationNumber)
    ?? normalizeBikeText(bike.serialNumber)
    ?? normalizeBikeText(bike.frameNumber);
  const latestCompletedText = formatDaysAgo(bike.serviceSummary?.latestCompletedAt);
  const latestUsedText = formatDaysAgo(bike.lastUsedAt ?? bike.serviceSummary?.latestJobAt);
  const parts = [
    detail,
    latestCompletedText
      ? `Last serviced: ${latestCompletedText}`
      : latestUsedText
        ? `Last in workshop: ${latestUsedText}`
        : null,
  ].filter(Boolean);

  return parts.join(" • ") || "No workshop history yet";
};

const parseBikeDate = (value: string | null | undefined) => {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
};

const getBikeSortTimestamp = (bike: CustomerBikeRecord) =>
  parseBikeDate(bike.lastUsedAt ?? bike.serviceSummary?.latestJobAt ?? bike.updatedAt ?? bike.createdAt);

const compareCustomerBikesByRecency = (left: CustomerBikeRecord, right: CustomerBikeRecord) => {
  const recencyDifference = getBikeSortTimestamp(right) - getBikeSortTimestamp(left);
  if (recencyDifference !== 0) {
    return recencyDifference;
  }

  const updatedDifference = parseBikeDate(right.updatedAt) - parseBikeDate(left.updatedAt);
  if (updatedDifference !== 0) {
    return updatedDifference;
  }

  const createdDifference = parseBikeDate(right.createdAt) - parseBikeDate(left.createdAt);
  if (createdDifference !== 0) {
    return createdDifference;
  }

  return left.displayName.localeCompare(right.displayName);
};

const isInspectionDiagnosticTemplate = (template: WorkshopServiceTemplate) => {
  const normalizedName = template.name.trim().toLocaleLowerCase();
  return normalizedName.includes("inspection") || normalizedName.includes("diagnostic");
};

const getStandardServiceLevelRank = (template: WorkshopServiceTemplate) => {
  const normalizedName = template.name.trim().toLocaleLowerCase();
  if (normalizedName.includes("basic") || normalizedName.includes("bronze")) {
    return 0;
  }
  if (normalizedName.includes("pro") || normalizedName.includes("silver")) {
    return 1;
  }
  if (normalizedName.includes("elite") || normalizedName.includes("gold")) {
    return 2;
  }
  return null;
};

const compareTemplatesForServicesQuickAccess = (left: WorkshopServiceTemplate, right: WorkshopServiceTemplate) => {
  const leftServiceLevelRank = getStandardServiceLevelRank(left);
  const rightServiceLevelRank = getStandardServiceLevelRank(right);
  const leftPriority = isInspectionDiagnosticTemplate(left) ? 0 : leftServiceLevelRank !== null ? 1 : 2;
  const rightPriority = isInspectionDiagnosticTemplate(right) ? 0 : rightServiceLevelRank !== null ? 1 : 2;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  if (leftPriority === 1 && rightPriority === 1 && leftServiceLevelRank !== rightServiceLevelRank) {
    return (leftServiceLevelRank ?? 0) - (rightServiceLevelRank ?? 0);
  }

  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }

  return left.name.localeCompare(right.name);
};

const buildTemplateQuickHint = (template: WorkshopServiceTemplate) => {
  if (isInspectionDiagnosticTemplate(template)) {
    return "Not sure? Start here";
  }

  const trimmedDescription = template.description?.trim();
  if (trimmedDescription && trimmedDescription.length <= 48) {
    return trimmedDescription;
  }

  return null;
};

const appendProblemWorkSnippet = (currentValue: string, snippet: string) => {
  const trimmedCurrent = currentValue.trim();
  if (!trimmedCurrent) {
    return snippet;
  }

  if (trimmedCurrent.toLocaleLowerCase().includes(snippet.toLocaleLowerCase())) {
    return currentValue;
  }

  const separator = /[.!?]$/.test(trimmedCurrent) ? " " : ". ";
  return `${currentValue.trimEnd()}${separator}${snippet}`;
};

const DEFAULT_SCHEDULE_DURATION_MINUTES = 30;

const parseInitialDurationMinutes = (value: string | number | null | undefined) => {
  const numeric = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return DEFAULT_SCHEDULE_DURATION_MINUTES;
  }
  return numeric;
};

const normalizeScheduleDateKey = (value: string | null | undefined) => {
  const trimmed = value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
};

const normalizeScheduleTimeValue = (value: string | null | undefined) => {
  const trimmed = value?.trim() ?? "";
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : "";
};

const formatScheduleSlotLabel = (dateKey: string, startTime: string, durationMinutes: number) => {
  if (!dateKey || !startTime) {
    return "Unscheduled";
  }

  const startAt = new Date(`${dateKey}T${startTime}:00`);
  if (Number.isNaN(startAt.getTime())) {
    return `${dateKey} · ${startTime}`;
  }

  return `${startAt.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  })} · ${startTime} · ${durationMinutes} min`;
};

type WorkshopCheckInPageProps = {
  embedded?: boolean;
  onClose?: () => void;
  onCreated?: (jobId: string) => Promise<void> | void;
  initialScheduleDraft?: WorkshopCheckInScheduleDraft | null;
};

export type WorkshopCheckInScheduleDraft = {
  dateKey: string;
  startTime: string;
  durationMinutes: number;
};

const renderStepIndicators = (step: number, onStepSelect?: (index: number) => void): ReactNode => (
  <div className="step-indicator-row">
    {stepTitles.map((title, index) => {
      const isActive = index === step;
      const isComplete = index < step;
      const isUpcoming = index > step;

      return (
        <div className="step-indicator-slot" key={title}>
          <button
            type="button"
            className={`step-indicator${isActive ? " step-indicator-active" : ""}${isComplete ? " step-indicator-complete step-indicator-clickable" : ""}${isUpcoming ? " step-indicator-upcoming" : ""}`}
            onClick={() => {
              if (isComplete) {
                onStepSelect?.(index);
              }
            }}
            disabled={!isComplete}
            aria-current={isActive ? "step" : undefined}
          >
            <span className="step-number" aria-hidden="true">{isComplete ? "\u2713" : index + 1}</span>
            <span className="step-indicator-label">{title}</span>
          </button>
          {index < stepTitles.length - 1 ? (
            <span
              className={`step-indicator-connector${index < step ? " step-indicator-connector-complete" : ""}`}
              aria-hidden="true"
            />
          ) : null}
        </div>
      );
    })}
  </div>
);

export const WorkshopCheckInPage = ({
  embedded = false,
  onClose,
  onCreated,
  initialScheduleDraft = null,
}: WorkshopCheckInPageProps = {}) => {
  const { success, error } = useToasts();
  const customerOptionRefs = useRef<Array<HTMLElement | null>>([]);
  const primaryStepActionRef = useRef<HTMLButtonElement | null>(null);
  const reviewSubmitIntentRef = useRef(false);
  const problemWorkTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasInitializedServicesTemplateRef = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCustomerId = searchParams.get("customerId");
  const initialBikeId = searchParams.get("bikeId");
  const initialScheduledDateFromParams = searchParams.get("scheduledDate");
  const initialScheduledTimeFromParams = searchParams.get("scheduledTime");
  const initialDurationFromParams = searchParams.get("durationMinutes");
  const initialScheduleState = useMemo(
    () => ({
      dateKey: normalizeScheduleDateKey(initialScheduleDraft?.dateKey ?? initialScheduledDateFromParams),
      startTime: normalizeScheduleTimeValue(initialScheduleDraft?.startTime ?? initialScheduledTimeFromParams),
      durationMinutes: parseInitialDurationMinutes(
        initialScheduleDraft?.durationMinutes ?? initialDurationFromParams,
      ),
    }),
    [
      initialDurationFromParams,
      initialScheduledDateFromParams,
      initialScheduledTimeFromParams,
      initialScheduleDraft,
    ],
  );

  const [step, setStep] = useState(0);
  const [customerSearch, setCustomerSearch] = useState("");
  const debouncedCustomerSearch = useDebouncedValue(customerSearch, 250);
  const [customerResults, setCustomerResults] = useState<CustomerRow[]>([]);
  const [highlightedCustomerOptionIndex, setHighlightedCustomerOptionIndex] = useState(-1);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [customerBikes, setCustomerBikes] = useState<CustomerBikeRecord[]>([]);
  const [loadingCustomerBikes, setLoadingCustomerBikes] = useState(false);
  const [workshopStartContext, setWorkshopStartContext] = useState<CustomerBikeWorkshopStartContextResponse | null>(null);
  const [loadingWorkshopStartContext, setLoadingWorkshopStartContext] = useState(false);

  const [manualCustomerName, setManualCustomerName] = useState("");
  const [manualCustomerMode, setManualCustomerMode] = useState(false);
  const [createCustomerInline, setCreateCustomerInline] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");

  const [bikeDescription, setBikeDescription] = useState("");
  const [selectedBikeId, setSelectedBikeId] = useState("");
  const [createBikeInline, setCreateBikeInline] = useState(false);
  const [bikeLabel, setBikeLabel] = useState("");
  const [bikeMake, setBikeMake] = useState("");
  const [bikeModel, setBikeModel] = useState("");
  const [bikeColour, setBikeColour] = useState("");
  const [bikeFrameNumber, setBikeFrameNumber] = useState("");
  const [bikeSerialNumber, setBikeSerialNumber] = useState("");
  const [bikeRegistrationNumber, setBikeRegistrationNumber] = useState("");
  const [bikeRecordNotes, setBikeRecordNotes] = useState("");
  const [bikeSearchModalOpen, setBikeSearchModalOpen] = useState(false);
  const [bikeCreateModalOpen, setBikeCreateModalOpen] = useState(false);
  const [bikeSearchText, setBikeSearchText] = useState("");
  const [problemWork, setProblemWork] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<WorkshopServiceTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedOptionalTemplateLineIds, setSelectedOptionalTemplateLineIds] = useState<string[]>([]);
  const [reviewActions, setReviewActions] = useState<WorkshopReviewActionState>({
    printJobTicket: true,
    sendCustomerConfirmationEmail: true,
  });
  const [scheduledDateKey, setScheduledDateKey] = useState(initialScheduleState.dateKey);
  const [scheduledStartTime, setScheduledStartTime] = useState(initialScheduleState.startTime);
  const [scheduledDurationMinutes, setScheduledDurationMinutes] = useState(
    initialScheduleState.durationMinutes,
  );
  const [scheduledDurationTouched, setScheduledDurationTouched] = useState(false);

  const resolvedCustomerName = useMemo(() => {
    if (selectedCustomer) {
      return selectedCustomer.name;
    }
    if (createCustomerInline) {
      return newCustomerName.trim();
    }
    return manualCustomerName.trim();
  }, [createCustomerInline, manualCustomerName, newCustomerName, selectedCustomer]);

  const checkInNotes = useMemo(
    () => buildCheckInNotes({ problemWork, additionalNotes }),
    [additionalNotes, problemWork],
  );
  const selectedBikeRecord = useMemo(() => {
    if (!selectedBikeId) {
      return null;
    }

    return customerBikes.find((bike) => bike.id === selectedBikeId)
      ?? (workshopStartContext?.bike.id === selectedBikeId ? workshopStartContext.bike : null);
  }, [customerBikes, selectedBikeId, workshopStartContext?.bike]);
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );
  const hasSelectedTemplate = Boolean(selectedTemplateId && selectedTemplate);
  const sortedTemplatesForServices = useMemo(
    () => [...templates].sort(compareTemplatesForServicesQuickAccess),
    [templates],
  );
  const defaultServicesTemplate = useMemo(
    () => sortedTemplatesForServices.find((template) => isInspectionDiagnosticTemplate(template)) ?? null,
    [sortedTemplatesForServices],
  );
  const selectedOptionalTemplateCount = useMemo(
    () => selectedTemplate?.lines.filter((line) => line.isOptional && selectedOptionalTemplateLineIds.includes(line.id)).length ?? 0,
    [selectedOptionalTemplateLineIds, selectedTemplate],
  );
  const reviewActionSummary = useMemo(() => {
    if (reviewActions.printJobTicket && reviewActions.sendCustomerConfirmationEmail) {
      return "Print job ticket and customer confirmation email will run after create.";
    }
    if (reviewActions.printJobTicket) {
      return "Print job ticket will run after create.";
    }
    if (reviewActions.sendCustomerConfirmationEmail) {
      return "Customer confirmation email will run after create.";
    }

    return "No follow-up actions will run after create.";
  }, [reviewActions]);
  const reviewWorkSummary = useMemo(() => {
    if (selectedTemplate) {
      return selectedTemplate.name;
    }
    if (problemWork.trim()) {
      return problemWork.trim();
    }

    return "Custom workshop work";
  }, [problemWork, selectedTemplate]);
  const reviewWorkDetail = useMemo(() => {
    if (selectedTemplate?.description?.trim()) {
      return selectedTemplate.description.trim();
    }
    if (!selectedTemplate && problemWork.trim()) {
      return "Entered manually during check-in.";
    }

    return "";
  }, [problemWork, selectedTemplate]);
  const hasScheduledSuggestion = Boolean(scheduledDateKey && scheduledStartTime);
  const normalizedScheduledDurationMinutes = Number.isInteger(scheduledDurationMinutes) && scheduledDurationMinutes > 0
    ? scheduledDurationMinutes
    : DEFAULT_SCHEDULE_DURATION_MINUTES;
  const scheduleSlotSummary = useMemo(
    () => formatScheduleSlotLabel(scheduledDateKey, scheduledStartTime, normalizedScheduledDurationMinutes),
    [normalizedScheduledDurationMinutes, scheduledDateKey, scheduledStartTime],
  );
  const canCreateBikeRecord = Boolean(selectedCustomer || createCustomerInline);
  const bikeDraftDisplayName = useMemo(
    () =>
      buildBikeDraftDisplayName({
        label: bikeLabel,
        make: bikeMake,
        model: bikeModel,
        colour: bikeColour,
        frameNumber: bikeFrameNumber,
        serialNumber: bikeSerialNumber,
        registrationNumber: bikeRegistrationNumber,
      }),
    [bikeColour, bikeFrameNumber, bikeLabel, bikeMake, bikeModel, bikeRegistrationNumber, bikeSerialNumber],
  );
  const trimmedCustomerSearch = customerSearch.trim();
  const showInlineCreateCustomerOption = useMemo(() => {
    if (!trimmedCustomerSearch || loadingCustomers) {
      return false;
    }

    const normalizedSearch = trimmedCustomerSearch.toLocaleLowerCase();
    return !customerResults.some((customer) => customer.name.trim().toLocaleLowerCase() === normalizedSearch);
  }, [customerResults, loadingCustomers, trimmedCustomerSearch]);
  const customerSearchOptionCount = customerResults.length + (showInlineCreateCustomerOption ? 1 : 0);
  const filteredCustomerBikes = useMemo(() => {
    const sortedBikes = [...customerBikes].sort(compareCustomerBikesByRecency);
    const query = bikeSearchText.trim().toLocaleLowerCase();
    if (!query) {
      return sortedBikes;
    }

    return sortedBikes.filter((bike) =>
      [
        bike.displayName,
        bike.label,
        bike.make,
        bike.model,
        bike.colour,
        bike.registrationNumber,
        bike.serialNumber,
        bike.frameNumber,
        bike.notes,
      ]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(query)),
    );
  }, [bikeSearchText, customerBikes]);
  const sortedCustomerBikes = useMemo(
    () => [...customerBikes].sort(compareCustomerBikesByRecency),
    [customerBikes],
  );
  const shouldScrollSavedBikeList = sortedCustomerBikes.length > 3;
  const isReviewStep = step === stepTitles.length - 1;

  useEffect(() => {
    let cancelled = false;

    const loadTemplates = async () => {
      setLoadingTemplates(true);
      try {
        const payload = await apiGet<WorkshopServiceTemplatesResponse>("/api/workshop/service-templates");
        if (!cancelled) {
          setTemplates(payload.templates || []);
        }
      } catch (loadError) {
        if (!cancelled) {
          error(loadError instanceof Error ? loadError.message : "Failed to load service templates");
        }
      } finally {
        if (!cancelled) {
          setLoadingTemplates(false);
        }
      }
    };

    void loadTemplates();
    return () => {
      cancelled = true;
    };
  }, [error]);

  useEffect(() => {
    setSelectedOptionalTemplateLineIds(getDefaultSelectedOptionalLineIds(selectedTemplate));
  }, [selectedTemplate]);

  useEffect(() => {
    if (step !== 2 || hasInitializedServicesTemplateRef.current) {
      return;
    }

    hasInitializedServicesTemplateRef.current = true;
    if (!selectedTemplateId && defaultServicesTemplate) {
      setSelectedTemplateId(defaultServicesTemplate.id);
    }
  }, [defaultServicesTemplate, selectedTemplateId, step]);

  useEffect(() => {
    if (!debouncedCustomerSearch.trim()) {
      setCustomerResults([]);
      return;
    }

    let cancelled = false;

    const loadCustomers = async () => {
      setLoadingCustomers(true);
      try {
        const params = new URLSearchParams({
          query: debouncedCustomerSearch.trim(),
          take: "8",
        });
        const payload = await apiGet<CustomerSearchResponse>(`/api/customers?${params.toString()}`);
        if (!cancelled) {
          setCustomerResults(payload.customers || []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setCustomerResults([]);
          error(loadError instanceof Error ? loadError.message : "Failed to load customers");
        }
      } finally {
        if (!cancelled) {
          setLoadingCustomers(false);
        }
      }
    };

    void loadCustomers();
    return () => {
      cancelled = true;
    };
  }, [debouncedCustomerSearch, error]);

  useEffect(() => {
    if (!trimmedCustomerSearch || customerSearchOptionCount === 0) {
      setHighlightedCustomerOptionIndex(-1);
      customerOptionRefs.current = [];
      return;
    }

    setHighlightedCustomerOptionIndex(0);
  }, [customerResults, customerSearchOptionCount, showInlineCreateCustomerOption, trimmedCustomerSearch]);

  useEffect(() => {
    if (highlightedCustomerOptionIndex < 0) {
      return;
    }

    customerOptionRefs.current[highlightedCustomerOptionIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [highlightedCustomerOptionIndex]);

  useEffect(() => {
    if (!initialBikeId) {
      return;
    }

    let cancelled = false;

    const loadWorkshopStartContext = async () => {
      setLoadingWorkshopStartContext(true);
      try {
        const payload = await apiGet<CustomerBikeWorkshopStartContextResponse>(
          `/api/customers/bikes/${encodeURIComponent(initialBikeId)}/workshop-start`,
        );
        if (!cancelled) {
          setWorkshopStartContext(payload);
          setSelectedCustomer(payload.customer);
          setCreateCustomerInline(false);
          setManualCustomerName("");
          setSelectedBikeId(payload.defaults.bikeId);
          setCreateBikeInline(false);
          setBikeDescription(payload.defaults.bikeDescription);
          setStep((current) => Math.max(current, 1));
        }
      } catch (loadError) {
        if (!cancelled) {
          const message = loadError instanceof Error
            ? loadError.message
            : "Failed to load selected bike";
          error(message);
        }
      } finally {
        if (!cancelled) {
          setLoadingWorkshopStartContext(false);
        }
      }
    };

    void loadWorkshopStartContext();
    return () => {
      cancelled = true;
    };
  }, [error, initialBikeId]);

  useEffect(() => {
    if (initialBikeId) {
      return;
    }

    if (!initialCustomerId) {
      return;
    }

    let cancelled = false;

    const loadInitialCustomer = async () => {
      try {
        const payload = await apiGet<CustomerResponse>(`/api/customers/${encodeURIComponent(initialCustomerId)}`);
        if (!cancelled) {
          setSelectedCustomer({
            id: payload.id,
            name: payload.name,
            email: payload.email,
            phone: payload.phone,
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          error(loadError instanceof Error ? loadError.message : "Failed to load selected customer");
        }
      }
    };

    void loadInitialCustomer();
    return () => {
      cancelled = true;
    };
  }, [error, initialBikeId, initialCustomerId]);

  useEffect(() => {
    if (!selectedCustomer?.id) {
      setCustomerBikes([]);
      setSelectedBikeId("");
      return;
    }

    let cancelled = false;

    const loadCustomerBikes = async () => {
      setLoadingCustomerBikes(true);
      try {
        const payload = await apiGet<CustomerBikesResponse>(
          `/api/customers/${encodeURIComponent(selectedCustomer.id)}/bikes`,
        );
        if (!cancelled) {
          setCustomerBikes(payload.bikes || []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setCustomerBikes([]);
          error(loadError instanceof Error ? loadError.message : "Failed to load customer bikes");
        }
      } finally {
        if (!cancelled) {
          setLoadingCustomerBikes(false);
        }
      }
    };

    void loadCustomerBikes();
    return () => {
      cancelled = true;
    };
  }, [error, selectedCustomer?.id]);

  const goNext = () => {
    reviewSubmitIntentRef.current = false;

    if (step === 0) {
      if (!resolvedCustomerName) {
        error("Choose an existing customer, create one, or enter a customer name.");
        return;
      }
    }

    if (step === 1) {
      if (!bikeDescription.trim()) {
        error("Bike description is required.");
        return;
      }
    }

    if (step === 2) {
      if (!problemWork.trim()) {
        error("Problem / Work is required.");
        return;
      }
    }

    setStep((current) => Math.min(current + 1, stepTitles.length - 1));
  };

  const goBack = () => {
    reviewSubmitIntentRef.current = false;
    setStep((current) => Math.max(current - 1, 0));
  };

  const goToPreviousStep = (targetStep: number) => {
    reviewSubmitIntentRef.current = false;
    setStep((current) => (targetStep < current ? targetStep : current));
  };

  const submitCheckIn = async (event: FormEvent) => {
    event.preventDefault();

    const shouldSubmitFromReview = isReviewStep && reviewSubmitIntentRef.current;
    reviewSubmitIntentRef.current = false;

    if (!shouldSubmitFromReview) {
      return;
    }

    if (!resolvedCustomerName || !bikeDescription.trim()) {
      error("Customer and bike details are required.");
      return;
    }
    if (!problemWork.trim()) {
      error("Problem / Work is required.");
      return;
    }
    if ((scheduledDateKey && !scheduledStartTime) || (!scheduledDateKey && scheduledStartTime)) {
      error("Choose both a scheduled date and time, or leave both blank.");
      return;
    }
    if (hasScheduledSuggestion && normalizedScheduledDurationMinutes <= 0) {
      error("Scheduled duration must be at least 1 minute.");
      return;
    }

    setSubmitting(true);
    try {
      const postCreateActions = {
        printJobTicket: reviewActions.printJobTicket,
        sendCustomerConfirmationEmail: reviewActions.sendCustomerConfirmationEmail,
      };

      let customerId = selectedCustomer?.id ?? null;

      if (!customerId && createCustomerInline) {
        const createdCustomer = await apiPost<CustomerResponse>("/api/customers", {
          name: newCustomerName.trim(),
          email: newCustomerEmail.trim() || undefined,
          phone: newCustomerPhone.trim() || undefined,
        });
        customerId = createdCustomer.id;
      }

      let bikeId = selectedBikeId || null;
      if (customerId && createBikeInline) {
        const createdBike = await apiPost<{ bike: CustomerBikeRecord }>(
          `/api/customers/${encodeURIComponent(customerId)}/bikes`,
          {
            label: bikeLabel.trim() || undefined,
            make: bikeMake.trim() || undefined,
            model: bikeModel.trim() || undefined,
            colour: bikeColour.trim() || undefined,
            frameNumber: bikeFrameNumber.trim() || undefined,
            serialNumber: bikeSerialNumber.trim() || undefined,
            registrationNumber: bikeRegistrationNumber.trim() || undefined,
            notes: bikeRecordNotes.trim() || undefined,
          },
        );
        bikeId = createdBike.bike.id;
      }

      const created = await apiPost<{ id: string }>("/api/workshop/jobs", {
        customerId,
        customerName: selectedCustomer ? undefined : resolvedCustomerName,
        bikeId,
        bikeDescription: bikeDescription.trim(),
        notes: checkInNotes || undefined,
        status: "BOOKED",
      });

      setCreatedJobId(created.id);
      let applyResponse: WorkshopServiceTemplateApplyResponse | null = null;
      if (selectedTemplateId) {
        try {
          applyResponse = await apiPost<WorkshopServiceTemplateApplyResponse>(
            `/api/workshop/jobs/${encodeURIComponent(created.id)}/templates/apply`,
            {
              templateId: selectedTemplateId,
              selectedOptionalLineIds: selectedOptionalTemplateLineIds,
            },
          );
          success(
            applyResponse.pricingEffect.fixedPriceActivated
              ? `Workshop check-in created, fixed-price template applied, and labour will rebalance to ${formatWorkshopTemplateMoney(applyResponse.pricingEffect.targetTotalPricePence ?? 0)}`
              : applyResponse.durationEffect.durationUpdated
                ? `Workshop check-in created, template applied, and planning duration set to ${applyResponse.durationEffect.appliedDurationMinutes} min`
                : postCreateActions.printJobTicket || postCreateActions.sendCustomerConfirmationEmail
                  ? "Workshop check-in created and template applied"
                  : "Workshop check-in created and template applied. Post-create actions are switched off for this intake",
          );
        } catch (templateError) {
          error(
            templateError instanceof Error
              ? `Workshop check-in created, but the template could not be applied: ${templateError.message}`
              : "Workshop check-in created, but the template could not be applied.",
          );
          return;
        }
      }

      if (hasScheduledSuggestion) {
        const scheduledStartAt = `${scheduledDateKey}T${scheduledStartTime}:00`;
        const plannedDurationMinutes = (
          !scheduledDurationTouched
          && applyResponse?.durationEffect.durationUpdated
          && applyResponse.durationEffect.appliedDurationMinutes
        )
          ? applyResponse.durationEffect.appliedDurationMinutes
          : normalizedScheduledDurationMinutes;

        try {
          await apiPatch(`/api/workshop/jobs/${encodeURIComponent(created.id)}/schedule`, {
            scheduledStartAt,
            durationMinutes: plannedDurationMinutes,
          });
        } catch (scheduleError) {
          error(
            scheduleError instanceof Error
              ? `Workshop check-in created, but the planned slot could not be saved: ${scheduleError.message}`
              : "Workshop check-in created, but the planned slot could not be saved.",
          );
          return;
        }
      }

      success(
        applyResponse
          ? applyResponse.pricingEffect.fixedPriceActivated
            ? `Workshop check-in created, fixed-price template applied, and labour will rebalance to ${formatWorkshopTemplateMoney(applyResponse.pricingEffect.targetTotalPricePence ?? 0)}`
            : applyResponse.durationEffect.durationUpdated
              ? `Workshop check-in created, template applied, and planning duration set to ${applyResponse.durationEffect.appliedDurationMinutes} min`
              : postCreateActions.printJobTicket || postCreateActions.sendCustomerConfirmationEmail
                ? "Workshop check-in created and template applied"
                : "Workshop check-in created and template applied. Post-create actions are switched off for this intake"
          : postCreateActions.printJobTicket || postCreateActions.sendCustomerConfirmationEmail
            ? "Workshop check-in created"
            : "Workshop check-in created. Post-create actions are switched off for this intake",
      );

      if (onCreated) {
        try {
          await Promise.resolve(onCreated(created.id));
        } catch (refreshError) {
          error(
            refreshError instanceof Error
              ? `Workshop check-in created, but the Workshop Operating Screen could not refresh: ${refreshError.message}`
              : "Workshop check-in created, but the Workshop Operating Screen could not refresh.",
          );
          return;
        }
      }

      if (embedded) {
        onClose?.();
      }
    } catch (submitError) {
      error(submitError instanceof Error ? submitError.message : "Failed to create workshop check-in");
    } finally {
      setSubmitting(false);
    }
  };

  const clearBikeLedContext = () => {
    setWorkshopStartContext(null);
    setSelectedCustomer(null);
    setSelectedBikeId("");
    setBikeDescription("");
    setCustomerBikes([]);
    setCreateBikeInline(false);
    setCreateCustomerInline(false);
    setStep(0);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("bikeId");
    setSearchParams(nextParams);
  };

  const resetBikeDraft = () => {
    setCreateBikeInline(false);
    setBikeLabel("");
    setBikeMake("");
    setBikeModel("");
    setBikeColour("");
    setBikeFrameNumber("");
    setBikeSerialNumber("");
    setBikeRegistrationNumber("");
    setBikeRecordNotes("");
  };

  const beginInlineCustomerCreateFromSearch = () => {
    const draftName = trimmedCustomerSearch || newCustomerName.trim();
    setManualCustomerMode(false);
    setCreateCustomerInline(true);
    setNewCustomerName(draftName);
    setSelectedCustomer(null);
    setManualCustomerName("");
    setSelectedBikeId("");
    resetBikeDraft();
    setHighlightedCustomerOptionIndex(-1);
  };

  const selectExistingCustomer = (customer: CustomerRow) => {
    setSelectedCustomer(customer);
    setManualCustomerMode(false);
    setCreateCustomerInline(false);
    setManualCustomerName("");
    setSelectedBikeId("");
    resetBikeDraft();
    setHighlightedCustomerOptionIndex(-1);
  };

  const clearCustomerSelection = () => {
    setSelectedCustomer(null);
    setManualCustomerMode(false);
    setCreateCustomerInline(false);
    setNewCustomerName("");
    setNewCustomerEmail("");
    setNewCustomerPhone("");
    setManualCustomerName("");
    setSelectedBikeId("");
    setCustomerBikes([]);
    resetBikeDraft();
    setHighlightedCustomerOptionIndex(-1);
  };

  const beginManualCustomerEntry = () => {
    clearCustomerSelection();
    setManualCustomerMode(true);
    setCustomerSearch("");
    setHighlightedCustomerOptionIndex(-1);
  };

  const selectBikeRecord = (bike: CustomerBikeRecord) => {
    setSelectedBikeId(bike.id);
    resetBikeDraft();
    setBikeDescription((current) => current.trim() || bike.displayName);
    setBikeSearchModalOpen(false);
  };

  const openBikeSelector = () => {
    setBikeSearchText("");
    setBikeSearchModalOpen(true);
  };

  const changeSelectedBike = () => {
    setSelectedBikeId("");
    openBikeSelector();
  };

  const clearSelectedBike = () => {
    setSelectedBikeId("");
  };

  const saveBikeDraft = () => {
    setSelectedBikeId("");
    setCreateBikeInline(true);
    setBikeDescription((current) => current.trim() || bikeDraftDisplayName);
    setBikeCreateModalOpen(false);
  };

  const applyQuickProblemChip = (snippet: string) => {
    setProblemWork((current) => appendProblemWorkSnippet(current, snippet));
  };

  const selectServiceTemplate = (templateId: string) => {
    hasInitializedServicesTemplateRef.current = true;
    setSelectedTemplateId(templateId);

    const activeElement = document.activeElement;
    const shouldMoveFocus = !activeElement || activeElement === document.body || activeElement instanceof HTMLButtonElement;
    if (!shouldMoveFocus) {
      return;
    }

    window.requestAnimationFrame(() => {
      problemWorkTextareaRef.current?.focus();
    });
  };

  const toggleReviewAction = (action: ReviewActionKey) => {
    setReviewActions((current) => ({
      ...current,
      [action]: !current[action],
    }));
  };

  useEffect(() => {
    if (!bikeSearchModalOpen && !bikeCreateModalOpen) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      if (bikeCreateModalOpen) {
        setBikeCreateModalOpen(false);
        return;
      }

      if (bikeSearchModalOpen) {
        setBikeSearchModalOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bikeCreateModalOpen, bikeSearchModalOpen]);

  useEffect(() => {
    if (step !== 0 || !selectedCustomer || bikeSearchModalOpen || bikeCreateModalOpen) {
      return;
    }

    const focusHandle = window.requestAnimationFrame(() => {
      primaryStepActionRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusHandle);
    };
  }, [bikeCreateModalOpen, bikeSearchModalOpen, selectedCustomer, step]);

  const persistBikeRecord = async (options: { useInIntake: boolean }) => {
    if (!selectedCustomer?.id) {
      if (options.useInIntake) {
        saveBikeDraft();
        return;
      }
      error("Save bike is only available once an existing customer has been selected.");
      return;
    }

    try {
      const createdBike = await apiPost<{ bike: CustomerBikeRecord }>(
        `/api/customers/${encodeURIComponent(selectedCustomer.id)}/bikes`,
        {
          label: bikeLabel.trim() || undefined,
          make: bikeMake.trim() || undefined,
          model: bikeModel.trim() || undefined,
          colour: bikeColour.trim() || undefined,
          frameNumber: bikeFrameNumber.trim() || undefined,
          serialNumber: bikeSerialNumber.trim() || undefined,
          registrationNumber: bikeRegistrationNumber.trim() || undefined,
          notes: bikeRecordNotes.trim() || undefined,
        },
      );

      setCustomerBikes((current) => [createdBike.bike, ...current]);
      resetBikeDraft();
      setBikeCreateModalOpen(false);
      success(options.useInIntake ? "Bike saved and linked to intake" : "Bike saved");

      if (options.useInIntake) {
        selectBikeRecord(createdBike.bike);
      }
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save bike");
    }
  };

  const handleFlowKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter" || event.defaultPrevented) {
      return;
    }

    if (bikeSearchModalOpen || bikeCreateModalOpen) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    if (target instanceof HTMLTextAreaElement || target.isContentEditable) {
      return;
    }

    if (target.closest("[data-customer-search-input='true']")) {
      return;
    }

    if (target instanceof HTMLButtonElement) {
      return;
    }

    event.preventDefault();
    if (step < stepTitles.length - 1) {
      goNext();
      return;
    }

    reviewSubmitIntentRef.current = true;
    event.currentTarget.requestSubmit(primaryStepActionRef.current ?? undefined);
  };

  const formContent = (
    <form
      className={embedded ? "workshop-checkin-flow workshop-checkin-flow--embedded" : "page-shell"}
      onSubmit={submitCheckIn}
      onKeyDown={handleFlowKeyDown}
    >
        <section className="card workshop-checkin-schedule-card">
          <div
            className="workshop-checkin-schedule-card__header"
            data-testid="workshop-checkin-planned-slot-summary"
          >
            <div>
              <span className="workshop-checkin-schedule-card__eyebrow">Planned slot</span>
              <strong>{hasScheduledSuggestion ? scheduleSlotSummary : "No slot selected yet"}</strong>
            </div>
            <span className="table-secondary">
              {hasScheduledSuggestion
                ? "This will prefill the new job timing and can still be adjusted before create."
                : "Optional. Double-click a scheduler slot to prefill this automatically."}
            </span>
          </div>
        </section>

        {step === 0 ? (
          <section className="card">
            <h2>Customer</h2>
            {workshopStartContext ? (
              <div className="restricted-panel info-panel" style={{ marginBottom: "12px" }}>
                <div className="job-meta-grid">
                  <div><strong>Starting from bike:</strong> <Link to={`/customers/bikes/${workshopStartContext.bike.id}`}>{workshopStartContext.bike.displayName}</Link></div>
                  <div><strong>Linked customer:</strong> <Link to={`/customers/${workshopStartContext.customer.id}`}>{workshopStartContext.customer.name}</Link></div>
                </div>
                <div className="actions-inline" style={{ marginTop: "8px" }}>
                  <button type="button" onClick={clearBikeLedContext}>
                    Use different bike / customer
                  </button>
                  <button type="button" className="primary" onClick={() => setStep(1)}>
                    Continue with linked bike
                  </button>
                </div>
              </div>
            ) : (
              <>
                {selectedCustomer ? (
                  <div className="selected-customer-panel" style={{ marginTop: "12px" }}>
                    <div className="grow">
                      <div className="eyebrow-label">Selected customer</div>
                      <strong>{selectedCustomer.name}</strong>
                      <div className="table-secondary">
                        {[selectedCustomer.email, selectedCustomer.phone].filter(Boolean).join(" • ") || "No email or phone on file"}
                      </div>
                    </div>
                    <div className="actions-inline">
                      <button type="button" onClick={clearCustomerSelection}>
                        Change customer
                      </button>
                    </div>
                  </div>
                ) : null}

                {!selectedCustomer ? (
                  <>
                    <div className="filter-row">
                      <label className="grow">
                        Search existing customer
                        <input
                          value={customerSearch}
                          onChange={(event) => setCustomerSearch(event.target.value)}
                          data-customer-search-input="true"
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              setHighlightedCustomerOptionIndex(-1);
                              return;
                            }

                            if (customerSearchOptionCount === 0) {
                              return;
                            }

                            if (event.key === "ArrowDown") {
                              event.preventDefault();
                              setHighlightedCustomerOptionIndex((current) => (
                                current < 0 ? 0 : Math.min(current + 1, customerSearchOptionCount - 1)
                              ));
                              return;
                            }

                            if (event.key === "ArrowUp") {
                              event.preventDefault();
                              setHighlightedCustomerOptionIndex((current) => (
                                current < 0 ? 0 : Math.max(current - 1, 0)
                              ));
                              return;
                            }

                            if (event.key !== "Enter" || highlightedCustomerOptionIndex < 0) {
                              return;
                            }

                            event.preventDefault();
                            if (highlightedCustomerOptionIndex < customerResults.length) {
                              selectExistingCustomer(customerResults[highlightedCustomerOptionIndex]);
                              return;
                            }

                            if (showInlineCreateCustomerOption) {
                              beginInlineCustomerCreateFromSearch();
                            }
                          }}
                          placeholder="name, phone, email"
                          aria-activedescendant={
                            highlightedCustomerOptionIndex >= 0
                              ? `workshop-checkin-customer-option-${highlightedCustomerOptionIndex}`
                              : undefined
                          }
                        />
                      </label>
                    </div>

                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Contact</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody role="listbox" aria-label="Customer search results">
                          {customerResults.length === 0 ? (
                            <tr>
                              <td colSpan={3}>
                                {loadingCustomers
                                  ? "Searching..."
                                  : customerSearch.trim()
                                    ? "No existing customers matched that search."
                                    : "Search for an existing customer to start the intake."}
                              </td>
                            </tr>
                          ) : customerResults.map((customer, index) => (
                            <tr
                              key={customer.id}
                              id={`workshop-checkin-customer-option-${index}`}
                              ref={(element) => {
                                customerOptionRefs.current[index] = element;
                              }}
                              className={index === highlightedCustomerOptionIndex ? "workshop-checkin-search-result workshop-checkin-search-result--active" : undefined}
                              role="option"
                              aria-selected={index === highlightedCustomerOptionIndex}
                              onMouseEnter={() => setHighlightedCustomerOptionIndex(index)}
                            >
                              <td>{customer.name}</td>
                              <td>
                                <div>{customer.email || "-"}</div>
                                <div className="table-secondary">{customer.phone || "-"}</div>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => {
                                    selectExistingCustomer(customer);
                                  }}
                                >
                                  Select
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {showInlineCreateCustomerOption ? (
                      <div
                        className={`restricted-panel info-panel workshop-checkin-create-customer-option${highlightedCustomerOptionIndex === customerResults.length ? " workshop-checkin-create-customer-option--active" : ""}`}
                        style={{ marginTop: "12px" }}
                        role="option"
                        aria-selected={highlightedCustomerOptionIndex === customerResults.length}
                      >
                        <div className="actions-inline" style={{ justifyContent: "space-between", gap: "12px" }}>
                          <div>
                            <strong>No exact customer match found.</strong>
                            <div className="table-secondary">Create a new customer directly from the name you just typed.</div>
                          </div>
                          <button
                            type="button"
                            className="primary"
                            id={`workshop-checkin-customer-option-${customerResults.length}`}
                            ref={(element) => {
                              customerOptionRefs.current[customerResults.length] = element;
                            }}
                            aria-selected={highlightedCustomerOptionIndex === customerResults.length}
                            onMouseEnter={() => setHighlightedCustomerOptionIndex(customerResults.length)}
                            onFocus={() => setHighlightedCustomerOptionIndex(customerResults.length)}
                            onClick={beginInlineCustomerCreateFromSearch}
                          >
                            Create new customer "{trimmedCustomerSearch}"
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className="actions-inline" style={{ marginTop: "12px" }}>
                      <button
                        type="button"
                        onClick={() => {
                          beginInlineCustomerCreateFromSearch();
                        }}
                      >
                        Create new customer
                      </button>
                      {!manualCustomerMode ? (
                        <button
                          type="button"
                          onClick={beginManualCustomerEntry}
                        >
                          Use walk-in name
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {!selectedCustomer && !createCustomerInline && manualCustomerMode ? (
                  <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
                    <div className="actions-inline" style={{ justifyContent: "space-between", gap: "12px", alignItems: "flex-start" }}>
                      <div className="grow">
                        <strong>Walk-in / manual customer</strong>
                        <div className="table-secondary">Use this only when you do not want to link the intake to an existing or newly created customer record.</div>
                      </div>
                      <button
                        type="button"
                        onClick={clearCustomerSelection}
                      >
                        Search instead
                      </button>
                    </div>
                    <div className="filter-row" style={{ marginTop: "12px" }}>
                      <label className="grow">
                        Customer name for intake
                        <input
                          value={manualCustomerName}
                          onChange={(event) => setManualCustomerName(event.target.value)}
                          placeholder="Walk-in customer or quick manual entry"
                        />
                      </label>
                    </div>
                  </div>
                ) : null}

                {createCustomerInline ? (
                  <div className="job-meta-grid" style={{ marginTop: "12px" }}>
                    <label>
                      New customer name
                      <input value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} />
                    </label>
                    <label>
                      Email
                      <input value={newCustomerEmail} onChange={(event) => setNewCustomerEmail(event.target.value)} />
                    </label>
                    <label>
                      Phone
                      <input value={newCustomerPhone} onChange={(event) => setNewCustomerPhone(event.target.value)} />
                    </label>
                  </div>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {step === 1 ? (
          <section className="card">
            <h2>Bike</h2>
            <p className="muted-text">Identify the bike first, then capture the service request on the next step.</p>
            {loadingWorkshopStartContext ? <p>Loading selected bike...</p> : null}
            {workshopStartContext ? (
              <div className="restricted-panel info-panel" style={{ marginBottom: "12px" }}>
                <div className="job-meta-grid">
                  <div><strong>Known bike:</strong> <Link to={`/customers/bikes/${workshopStartContext.bike.id}`}>{workshopStartContext.bike.displayName}</Link></div>
                  <div><strong>Customer:</strong> <Link to={`/customers/${workshopStartContext.customer.id}`}>{workshopStartContext.customer.name}</Link></div>
                  <div><strong>Bike notes:</strong> {workshopStartContext.bike.notes || "-"}</div>
                  <div><strong>Prefilled summary:</strong> {workshopStartContext.defaults.bikeDescription}</div>
                </div>
                <div className="actions-inline" style={{ marginTop: "8px" }}>
                  <button type="button" onClick={clearBikeLedContext}>
                    Change bike / customer
                  </button>
                </div>
              </div>
            ) : null}
            {canCreateBikeRecord ? (
              <>
                <div className="restricted-panel info-panel workshop-checkin-bike-picker">
                  {selectedCustomer ? (
                    <div className={`workshop-checkin-bike-picker__availability${sortedCustomerBikes.length > 0 ? " workshop-checkin-bike-picker__availability--found" : ""}`}>
                      <div className="grow">
                        <strong>
                          {loadingCustomerBikes
                            ? `Loading saved bikes for ${selectedCustomer.name}`
                            : sortedCustomerBikes.length > 0
                              ? `${sortedCustomerBikes.length} saved bikes found for ${selectedCustomer.name}`
                              : `No saved bikes found for ${selectedCustomer.name}`}
                        </strong>
                        <div className="table-secondary">
                          {loadingCustomerBikes
                            ? "Checking this customer's bike records."
                            : sortedCustomerBikes.length > 0
                              ? "Use a saved bike inline below. Most recently used bikes appear first."
                              : "Add a new bike now, or continue with the workshop bike summary below."}
                        </div>
                      </div>
                      <div className="actions-inline">
                        {sortedCustomerBikes.length > 0 ? (
                          <button
                            type="button"
                            className="primary"
                            onClick={openBikeSelector}
                          >
                            Search/select bike
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={sortedCustomerBikes.length === 0 ? "primary" : undefined}
                          onClick={() => setBikeCreateModalOpen(true)}
                        >
                          Add new bike
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {selectedBikeRecord ? (
                    <div className="workshop-checkin-bike-picker__selected workshop-checkin-bike-picker__selected--active">
                      <div className="grow">
                        <div className="eyebrow-label">Selected bike</div>
                        <strong>{buildBikeInlineSummary(selectedBikeRecord)}</strong>
                        <div className="table-secondary">
                          {buildBikeInlineMeta(selectedBikeRecord)}
                        </div>
                      </div>
                      <div className="actions-inline">
                        <button type="button" onClick={changeSelectedBike}>
                          Change
                        </button>
                        <button type="button" onClick={clearSelectedBike}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {!selectedBikeRecord && selectedCustomer && sortedCustomerBikes.length > 0 ? (
                    <div
                      className={`workshop-checkin-bike-picker__list${shouldScrollSavedBikeList ? " workshop-checkin-bike-picker__list--scrollable" : ""}`}
                      role="list"
                      aria-label={`Saved bikes for ${selectedCustomer.name}`}
                    >
                      {sortedCustomerBikes.map((bike) => {
                        const isSelected = bike.id === selectedBikeId;

                        return (
                          <article
                            key={bike.id}
                            className={`workshop-checkin-bike-picker__list-item${isSelected ? " workshop-checkin-bike-picker__list-item--selected" : ""}`}
                            role="listitem"
                          >
                            <label className="workshop-checkin-bike-picker__list-item-label">
                              <input
                                type="radio"
                                className="workshop-checkin-bike-picker__list-item-input"
                                name="selected-bike-record"
                                checked={isSelected}
                                onChange={() => selectBikeRecord(bike)}
                              />
                              <div className="grow">
                                <strong className="workshop-checkin-bike-picker__list-summary">{buildBikeInlineSummary(bike)}</strong>
                                <div className="table-secondary">{buildBikeInlineMeta(bike)}</div>
                              </div>
                            </label>
                          </article>
                        );
                      })}
                    </div>
                  ) : null}

                  {createBikeInline ? (
                    <div className="workshop-checkin-bike-picker__selected">
                      <div>
                        <strong>{bikeDraftDisplayName}</strong>
                        <div className="table-secondary">
                          New bike record will be created with this check-in.
                        </div>
                      </div>
                      <div className="actions-inline">
                        <button type="button" onClick={() => setBikeCreateModalOpen(true)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            resetBikeDraft();
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  ) : null}

                </div>
              </>
            ) : (
              <p className="muted-text">
                Choose or create a customer to link a saved bike. Manual walk-in check-ins can still use the workshop bike summary below.
              </p>
            )}
            <div className="job-meta-grid">
              <label>
                Workshop bike summary
                <input
                  value={bikeDescription}
                  onChange={(event) => setBikeDescription(event.target.value)}
                  placeholder={workshopStartContext ? "Prefilled from the linked bike record" : "e.g. Trek road bike, blue, 56cm"}
                />
              </label>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="card">
            <h2>Services</h2>
            {selectedBikeRecord?.commercialInsights ? (
              <WorkshopCommercialInsightsPanel
                insights={selectedBikeRecord.commercialInsights}
                title="Bike-specific service prompts"
                description="These prompts are based on the selected bike's linked workshop history and care-plan timing, so staff can raise relevant work without guessing."
                dataTestId="workshop-checkin-commercial-insights"
                onUseSnippet={(snippet) => setProblemWork((current) => appendProblemWorkSnippet(current, snippet))}
                useSnippetLabel="Use in problem/work"
              />
            ) : null}
            <div className="workshop-checkin-services-template">
              {loadingTemplates ? (
                <div className="table-secondary">Loading active service templates...</div>
              ) : (
                <div
                  className="workshop-checkin-services-template__grid"
                  role="list"
                  aria-label="Quick access service templates"
                >
                  {sortedTemplatesForServices.map((template) => {
                    const isSelected = selectedTemplateId === template.id;
                    const quickHint = buildTemplateQuickHint(template);
                    const isFeatured = isInspectionDiagnosticTemplate(template);
                    return (
                      <button
                        key={template.id}
                        type="button"
                        className={`workshop-checkin-services-template__option${isSelected ? " workshop-checkin-services-template__option--active" : ""}${isFeatured ? " workshop-checkin-services-template__option--featured" : ""}`}
                        onClick={() => selectServiceTemplate(template.id)}
                        aria-pressed={isSelected}
                      >
                        <span className="workshop-checkin-services-template__option-title-row">
                          <strong>{template.name}</strong>
                          {isSelected ? (
                            <span className="workshop-checkin-services-template__option-check" aria-hidden="true">
                              ✓
                            </span>
                          ) : null}
                        </span>
                        <span className="workshop-checkin-services-template__option-meta">
                          {[
                            template.category,
                            template.defaultDurationMinutes ? `${template.defaultDurationMinutes} min` : null,
                            template.pricingMode === "FIXED_PRICE_SERVICE" ? "Fixed price" : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Workshop template"}
                        </span>
                        {quickHint ? (
                          <span className="table-secondary">
                            {quickHint}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={`workshop-checkin-services-template__option workshop-checkin-services-template__option--custom${!hasSelectedTemplate ? " workshop-checkin-services-template__option--active" : ""}`}
                    onClick={() => selectServiceTemplate("")}
                    aria-pressed={!hasSelectedTemplate}
                  >
                    <span className="workshop-checkin-services-template__option-title-row">
                      <strong>Custom work</strong>
                      {!hasSelectedTemplate ? (
                        <span className="workshop-checkin-services-template__option-check" aria-hidden="true">
                          ✓
                        </span>
                      ) : null}
                    </span>
                    <span className="workshop-checkin-services-template__option-meta">
                      No template
                    </span>
                  </button>
                </div>
              )}
              <div className="table-secondary">
                {selectedTemplate
                  ? `Selected: ${selectedTemplate.name}`
                  : "Choose a template or stay with Custom work. You can refine details later on the job card."}
              </div>
              {selectedTemplate ? (
                <WorkshopServiceTemplatePreview
                  template={selectedTemplate}
                  selectedOptionalLineIds={selectedOptionalTemplateLineIds}
                  onToggleOptionalLine={(lineId) =>
                    setSelectedOptionalTemplateLineIds((current) =>
                      current.includes(lineId)
                        ? current.filter((entry) => entry !== lineId)
                        : [...current, lineId],
                    )}
                  emptyOptionalLabel="Optional part suggestions are currently included in this intake."
                />
              ) : null}
            </div>
            <div className="workshop-checkin-services-template__chips">
              <div>
                <strong>Quick problem chips</strong>
              </div>
              <div className="workshop-checkin-services-template__chip-list" role="list" aria-label="Quick problem chips">
                {QUICK_PROBLEM_WORK_CHIPS.map((chip) => {
                  const isApplied = problemWork.toLocaleLowerCase().includes(chip.text.toLocaleLowerCase());
                  return (
                    <button
                      key={chip.label}
                      type="button"
                      className={`workshop-checkin-services-template__chip${isApplied ? " workshop-checkin-services-template__chip--active" : ""}`}
                      onClick={() => applyQuickProblemChip(chip.text)}
                      aria-pressed={isApplied}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="job-meta-grid">
              <label>
                Problem / Work (Customer Facing)
                <textarea
                  ref={problemWorkTextareaRef}
                  value={problemWork}
                  onChange={(event) => setProblemWork(event.target.value)}
                  rows={4}
                  placeholder="Describe the problem or requested work"
                />
              </label>
              <label>
                Additional notes (Internal)
                <textarea
                  value={additionalNotes}
                  onChange={(event) => setAdditionalNotes(event.target.value)}
                  rows={4}
                  placeholder="Accessories left with bike, visible damage, extra notes"
                />
              </label>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="card workshop-checkin-review-step">
            <div className="workshop-checkin-review-hero">
              <div className="workshop-checkin-review-hero__copy">
                <p className="workshop-checkin-review-hero__eyebrow">Final review</p>
                <h2>Review & Confirm</h2>
                <p className="muted-text">Check the customer, bike, work to be done, and follow-up actions before you create the job.</p>
              </div>
              <div className="workshop-checkin-review-hero__status">
                <span className="workshop-checkin-review-hero__status-pill">Ready to create</span>
                <strong>{reviewActionSummary}</strong>
                <span>Work to be done: {reviewWorkSummary}</span>
              </div>
            </div>

            <div className="workshop-checkin-review-grid">
              <section className="workshop-checkin-review-panel workshop-checkin-review-panel--primary">
                <div className="workshop-checkin-review-panel__header">
                  <span className="workshop-checkin-review-panel__eyebrow">Customer & Bike</span>
                  <strong>Check-in overview</strong>
                </div>
                <div className="workshop-checkin-review-detail-grid">
                  <div className="workshop-checkin-review-detail-card">
                    <span className="workshop-checkin-review-detail-card__label">Customer</span>
                    <strong>{resolvedCustomerName || "-"}</strong>
                  </div>
                  <div className="workshop-checkin-review-detail-card">
                    <span className="workshop-checkin-review-detail-card__label">Workshop bike summary</span>
                    <strong>{bikeDescription || "-"}</strong>
                  </div>
                  <div className="workshop-checkin-review-detail-card">
                    <span className="workshop-checkin-review-detail-card__label">Linked bike</span>
                    <strong>
                      {createBikeInline
                        ? `${bikeDraftDisplayName} (new record will be created with this check-in)`
                        : selectedBikeId
                          ? selectedBikeRecord?.displayName || "Existing bike selected"
                          : "No linked bike record"}
                    </strong>
                  </div>
                  <div className="workshop-checkin-review-detail-card">
                    <span className="workshop-checkin-review-detail-card__label">Intake source</span>
                    <strong>
                      {workshopStartContext
                        ? `Started from ${workshopStartContext.bike.displayName}`
                        : "Manual check-in flow"}
                    </strong>
                  </div>
                </div>
              </section>

              <section className="workshop-checkin-review-panel workshop-checkin-review-panel--info">
                <div className="workshop-checkin-review-panel__header">
                  <span className="workshop-checkin-review-panel__eyebrow">Intake summary</span>
                  <strong>Notes from check-in</strong>
                </div>
                <pre className="note-pre workshop-checkin-review-note-pre">{checkInNotes || "No additional notes captured."}</pre>
              </section>

              <section className="workshop-checkin-review-panel">
                <div className="workshop-checkin-review-panel__header">
                  <span className="workshop-checkin-review-panel__eyebrow">Work to be done</span>
                  <strong>Service summary</strong>
                </div>
                <div className="workshop-checkin-review-summary-list">
                  <div className="workshop-checkin-review-summary-row">
                    <span>Work selected</span>
                    <strong>{reviewWorkSummary}</strong>
                  </div>
                  {selectedOptionalTemplateCount > 0 ? (
                    <div className="workshop-checkin-review-summary-row">
                      <span>Optional extras</span>
                      <strong>{selectedOptionalTemplateCount} selected</strong>
                    </div>
                  ) : null}
                </div>
                {reviewWorkDetail ? (
                  <div className="table-secondary workshop-checkin-review-helper-copy">
                    {reviewWorkDetail}
                  </div>
                ) : null}
              </section>

              <section className="workshop-checkin-review-panel">
                <div className="workshop-checkin-review-panel__header">
                  <span className="workshop-checkin-review-panel__eyebrow">Scheduler</span>
                  <strong>Planned timing</strong>
                </div>
                <div className="table-secondary workshop-checkin-review-helper-copy">
                  Leave the date and time blank if you want to create the job unscheduled.
                </div>
                <div className="job-meta-grid workshop-checkin-review-schedule-grid">
                  <label>
                    Date
                    <input
                      type="date"
                      data-testid="workshop-checkin-scheduled-date"
                      value={scheduledDateKey}
                      onChange={(event) => setScheduledDateKey(event.target.value)}
                    />
                  </label>
                  <label>
                    Start time
                    <input
                      type="time"
                      data-testid="workshop-checkin-scheduled-time"
                      value={scheduledStartTime}
                      onChange={(event) => setScheduledStartTime(event.target.value)}
                    />
                  </label>
                  <label>
                    Duration (minutes)
                    <input
                      type="number"
                      data-testid="workshop-checkin-scheduled-duration"
                      min="1"
                      step="15"
                      value={scheduledDurationMinutes}
                      onChange={(event) => {
                        setScheduledDurationTouched(true);
                        setScheduledDurationMinutes(parseInitialDurationMinutes(event.target.value));
                      }}
                    />
                  </label>
                </div>
                <div className="workshop-checkin-review-summary-row workshop-checkin-review-summary-row--schedule">
                  <span>Current slot</span>
                  <strong>{hasScheduledSuggestion ? scheduleSlotSummary : "Unscheduled"}</strong>
                </div>
              </section>

              <section className="workshop-checkin-review-panel workshop-checkin-review-panel--actions">
                <div className="workshop-checkin-review-panel__header">
                  <span className="workshop-checkin-review-panel__eyebrow">After create</span>
                  <strong>Optional actions</strong>
                </div>
                <div className="table-secondary workshop-checkin-review-helper-copy">
                  These actions run as soon as the job is created.
                </div>
                <div className="pos-context-pill-row workshop-checkin-review-actions">
                  {REVIEW_ACTION_PILLS.map((action) => {
                    const isActive = reviewActions[action.key];
                    return (
                      <button
                        key={action.key}
                        type="button"
                        className={`workshop-checkin-review-action pos-context-pill${isActive ? "" : " pos-context-pill-soft"}${isActive ? " workshop-checkin-review-action--active" : " workshop-checkin-review-action--inactive"}`}
                        onClick={() => toggleReviewAction(action.key)}
                        aria-pressed={isActive}
                      >
                        <span
                          aria-hidden="true"
                          className={`workshop-checkin-review-action__dot${isActive ? "" : " workshop-checkin-review-action__dot--inactive"}`}
                        />
                        <span className="workshop-checkin-review-action__label">{action.label}</span>
                        <span className="workshop-checkin-review-action__state">{isActive ? "On" : "Off"}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
            {createdJobId ? (
              <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
                Workshop job created: <Link to={`/workshop/${createdJobId}?tab=schedule`}>{createdJobId}</Link>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="card">
          <div className="actions-inline">
            <button type="button" onClick={goBack} disabled={step === 0}>
              Back
            </button>
            {!isReviewStep ? (
              <button key="workshop-checkin-next" type="button" className="primary" onClick={goNext} ref={primaryStepActionRef}>
                Next
              </button>
            ) : (
              <button
                key="workshop-checkin-submit"
                type="submit"
                className="primary"
                disabled={submitting || Boolean(createdJobId)}
                ref={primaryStepActionRef}
                onClick={() => {
                  reviewSubmitIntentRef.current = true;
                }}
              >
                {submitting ? "Creating..." : createdJobId ? "Created" : "Create check-in"}
              </button>
            )}
          </div>
        </section>
      </form>
  );

  if (embedded) {
    return (
      <div className="workshop-checkin-modal-body">
        <section className="card workshop-checkin-modal-intro">
          {createdJobId ? (
            <div className="card-header-row">
              <div />
              <Link to={`/workshop/${createdJobId}`}>Open created job</Link>
            </div>
          ) : null}
          {renderStepIndicators(step, goToPreviousStep)}
        </section>
        {formContent}
        {bikeSearchModalOpen ? (
          <div className="workshop-checkin-submodal-backdrop" onClick={() => setBikeSearchModalOpen(false)} aria-hidden="true">
            <aside
              className="workshop-os-modal workshop-checkin-submodal"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Search existing bike"
            >
              <div className="workshop-os-modal__header">
                <div className="workshop-os-drawer__header">
                  <div className="workshop-os-overlay-hero__title">
                    <p className="ui-page-eyebrow">Bike Search</p>
                    <h2>Select existing bike</h2>
                    <p className="table-secondary">Search linked bikes for the selected customer. Most recently used bikes appear first.</p>
                  </div>
                  <button type="button" onClick={() => setBikeSearchModalOpen(false)} aria-label="Close bike search">
                    Close
                  </button>
                </div>
              </div>
              <div className="workshop-os-modal__content workshop-checkin-submodal__content">
                <label className="grow">
                  Search bikes
                  <input
                    value={bikeSearchText}
                    onChange={(event) => setBikeSearchText(event.target.value)}
                    placeholder="Search make, model, colour, serial, registration"
                  />
                </label>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Bike</th>
                        <th>Details</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCustomerBikes.length === 0 ? (
                        <tr>
                          <td colSpan={3}>
                            {loadingCustomerBikes
                              ? "Loading bikes..."
                              : bikeSearchText.trim()
                                ? "No customer bikes matched that search."
                                : "No saved bikes are available for this customer yet."}
                          </td>
                        </tr>
                      ) : filteredCustomerBikes.map((bike) => (
                        <tr key={bike.id}>
                          <td>{bike.displayName}</td>
                          <td>
                            <div>{bike.notes || bike.make || bike.model || "-"}</div>
                            <div className="table-secondary">{bike.registrationNumber || bike.serialNumber || bike.frameNumber || "-"}</div>
                          </td>
                          <td>
                            <button type="button" onClick={() => selectBikeRecord(bike)}>
                              Use
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </aside>
          </div>
        ) : null}
        {bikeCreateModalOpen ? (
          <div className="workshop-checkin-submodal-backdrop" onClick={() => setBikeCreateModalOpen(false)} aria-hidden="true">
            <aside
              className="workshop-os-modal workshop-checkin-submodal"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Add new bike"
            >
              <div className="workshop-os-modal__header">
                <div className="workshop-os-drawer__header">
                  <div className="workshop-os-overlay-hero__title">
                    <p className="ui-page-eyebrow">Bike Record</p>
                    <h2>Add new bike</h2>
                    <p className="table-secondary">Capture the bike record separately, then return it to the Bike step.</p>
                  </div>
                  <button type="button" onClick={() => setBikeCreateModalOpen(false)} aria-label="Close bike create">
                    Close
                  </button>
                </div>
              </div>
              <div className="workshop-os-modal__content workshop-checkin-submodal__content">
                <div className="job-meta-grid">
                  <label>
                    Nickname / label
                    <input value={bikeLabel} onChange={(event) => setBikeLabel(event.target.value)} placeholder="Winter commuter" />
                  </label>
                  <label>
                    Make
                    <input value={bikeMake} onChange={(event) => setBikeMake(event.target.value)} placeholder="Trek" />
                  </label>
                  <label>
                    Model
                    <input value={bikeModel} onChange={(event) => setBikeModel(event.target.value)} placeholder="Domane AL 2" />
                  </label>
                  <label>
                    Colour
                    <input value={bikeColour} onChange={(event) => setBikeColour(event.target.value)} placeholder="Blue" />
                  </label>
                  <label>
                    Frame number
                    <input value={bikeFrameNumber} onChange={(event) => setBikeFrameNumber(event.target.value)} />
                  </label>
                  <label>
                    Serial number
                    <input value={bikeSerialNumber} onChange={(event) => setBikeSerialNumber(event.target.value)} />
                  </label>
                  <label>
                    Registration
                    <input value={bikeRegistrationNumber} onChange={(event) => setBikeRegistrationNumber(event.target.value)} />
                  </label>
                  <label className="grow">
                    Bike record notes
                    <textarea value={bikeRecordNotes} onChange={(event) => setBikeRecordNotes(event.target.value)} rows={3} />
                  </label>
                </div>
                <div className="restricted-panel info-panel">
                  <strong>Preview</strong>
                  <div className="table-secondary">{bikeDraftDisplayName}</div>
                </div>
              </div>
              <div className="workshop-os-modal__footer">
                <div className="workshop-os-modal__footer-message">
                  {selectedCustomer
                    ? "Save the bike record now, or return it directly into intake. Bike summary stays editable separately."
                    : "Bike summary will remain editable separately in the intake step. Save bike requires an existing customer record."}
                </div>
                <div className="workshop-os-modal__footer-actions">
                  <div className="actions-inline">
                    <button type="button" onClick={() => setBikeCreateModalOpen(false)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void persistBikeRecord({ useInIntake: false });
                      }}
                      disabled={!selectedCustomer}
                    >
                      Save bike
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        void persistBikeRecord({ useInIntake: true });
                      }}
                    >
                      Use bike in intake
                    </button>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Check-In</h1>
            <p className="muted-text">
              Capture customer, bike, and intake details before the job moves onto the workshop board.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/workshop">Back to workshop</Link>
            {createdJobId ? <Link to={`/workshop/${createdJobId}`}>Open created job</Link> : null}
          </div>
        </div>

        {renderStepIndicators(step, goToPreviousStep)}
      </section>

      {formContent}
    </div>
  );
};
