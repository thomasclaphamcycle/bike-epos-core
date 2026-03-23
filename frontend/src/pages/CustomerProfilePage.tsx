import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import {
  BIKE_SERVICE_SCHEDULE_TYPE_OPTIONS,
  bikeServiceScheduleDueStatusClass,
  bikeServiceScheduleDueStatusLabel,
  defaultBikeServiceScheduleTitle,
  type BikeServiceScheduleDueStatus,
  type BikeServiceScheduleType,
} from "../features/bikes/serviceSchedules";
import {
  workshopExecutionStatusClass,
  workshopExecutionStatusLabel,
  workshopRawStatusLabel,
} from "../features/workshop/status";
import { toBackendUrl } from "../utils/backendUrl";

const ACTIVE_SALE_KEY = "corepos.activeSaleId";

type Customer = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  emailAllowed: boolean;
  smsAllowed: boolean;
  whatsappAllowed: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type CustomerCommunicationPreferences = Pick<
  Customer,
  "emailAllowed" | "smsAllowed" | "whatsappAllowed"
>;

type CustomerSales = {
  sales: Array<{
    id: string;
    totalPence: number;
    createdAt: string;
    completedAt: string | null;
    receiptNumber: string | null;
  }>;
};

type CustomerWorkshopJob = {
  id: string;
  bikeId: string | null;
  status: string;
  rawStatus: string;
  bikeDescription: string | null;
  notes: string | null;
  scheduledDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type CustomerWorkshopJobs = {
  jobs?: CustomerWorkshopJob[];
  workshopJobs?: CustomerWorkshopJob[];
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
  wheelSize: string | null;
  frameSize: string | null;
  groupset: string | null;
  motorBrand: string | null;
  motorModel: string | null;
  batterySerial: string | null;
  frameNumber: string | null;
  serialNumber: string | null;
  registrationNumber: string | null;
  notes: string | null;
  displayName: string;
  serviceSummary: {
    linkedJobCount: number;
    openJobCount: number;
    completedJobCount: number;
    firstJobAt: string | null;
    latestJobAt: string | null;
    latestCompletedAt: string | null;
  };
  serviceSchedules: BikeServiceScheduleRecord[];
  serviceScheduleSummary: BikeServiceScheduleSummary;
};

type BikeServiceScheduleRecord = {
  id: string;
  bikeId: string;
  type: BikeServiceScheduleType;
  typeLabel: string;
  title: string;
  description: string | null;
  intervalMonths: number | null;
  intervalMileage: number | null;
  lastServiceAt: string | null;
  lastServiceMileage: number | null;
  nextDueAt: string | null;
  nextDueMileage: number | null;
  isActive: boolean;
  dueStatus: BikeServiceScheduleDueStatus;
  dueSummaryText: string;
  cadenceSummaryText: string;
  lastServiceSummaryText: string;
  createdAt: string;
  updatedAt: string;
};

type BikeServiceScheduleSummary = {
  activeCount: number;
  inactiveCount: number;
  dueCount: number;
  overdueCount: number;
  upcomingCount: number;
  primarySchedule: BikeServiceScheduleRecord | null;
};

type CustomerBikesResponse = {
  bikes: CustomerBikeRecord[];
};

type BikeProfileFormState = {
  label: string;
  make: string;
  model: string;
  year: string;
  bikeType: string;
  colour: string;
  wheelSize: string;
  frameSize: string;
  groupset: string;
  motorBrand: string;
  motorModel: string;
  batterySerial: string;
  frameNumber: string;
  serialNumber: string;
  registrationNumber: string;
  notes: string;
};

type BikeServiceScheduleFormState = {
  type: BikeServiceScheduleType;
  title: string;
  description: string;
  intervalMonths: string;
  intervalMileage: string;
  lastServiceAt: string;
  lastServiceMileage: string;
  nextDueAt: string;
  nextDueMileage: string;
  isActive: boolean;
};

type BikeServiceRefreshFormState = {
  servicedAt: string;
  servicedMileage: string;
};

const CUSTOMER_BIKE_YEAR_MIN = 1900;
const CUSTOMER_BIKE_YEAR_MAX = new Date().getUTCFullYear() + 1;
const BIKE_TYPE_OPTIONS = [
  { value: "ROAD", label: "Road" },
  { value: "MTB", label: "Mountain bike" },
  { value: "E_BIKE", label: "E-bike" },
  { value: "HYBRID", label: "Hybrid" },
  { value: "GRAVEL", label: "Gravel" },
  { value: "COMMUTER", label: "Commuter" },
  { value: "BMX", label: "BMX" },
  { value: "KIDS", label: "Kids" },
  { value: "CARGO", label: "Cargo" },
  { value: "FOLDING", label: "Folding" },
  { value: "OTHER", label: "Other" },
] as const;

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatOptionalDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "-";

const formatOptionalDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : "-";

const createEmptyBikeForm = (): BikeProfileFormState => ({
  label: "",
  make: "",
  model: "",
  year: "",
  bikeType: "",
  colour: "",
  wheelSize: "",
  frameSize: "",
  groupset: "",
  motorBrand: "",
  motorModel: "",
  batterySerial: "",
  frameNumber: "",
  serialNumber: "",
  registrationNumber: "",
  notes: "",
});

const toDateInputValue = (value: string | Date | null | undefined) => {
  if (!value) {
    return "";
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const createEmptyScheduleForm = (): BikeServiceScheduleFormState => ({
  type: "GENERAL_SERVICE",
  title: defaultBikeServiceScheduleTitle("GENERAL_SERVICE"),
  description: "",
  intervalMonths: "",
  intervalMileage: "",
  lastServiceAt: "",
  lastServiceMileage: "",
  nextDueAt: "",
  nextDueMileage: "",
  isActive: true,
});

const toScheduleFormState = (
  schedule: BikeServiceScheduleRecord,
): BikeServiceScheduleFormState => ({
  type: schedule.type,
  title: schedule.title,
  description: schedule.description ?? "",
  intervalMonths: schedule.intervalMonths ? String(schedule.intervalMonths) : "",
  intervalMileage: schedule.intervalMileage ? String(schedule.intervalMileage) : "",
  lastServiceAt: toDateInputValue(schedule.lastServiceAt),
  lastServiceMileage:
    schedule.lastServiceMileage !== null ? String(schedule.lastServiceMileage) : "",
  nextDueAt: toDateInputValue(schedule.nextDueAt),
  nextDueMileage: schedule.nextDueMileage !== null ? String(schedule.nextDueMileage) : "",
  isActive: schedule.isActive,
});

const createDefaultServiceRefreshForm = (): BikeServiceRefreshFormState => ({
  servicedAt: toDateInputValue(new Date()),
  servicedMileage: "",
});

const toBikeFormState = (bike: CustomerBikeRecord): BikeProfileFormState => ({
  label: bike.label ?? "",
  make: bike.make ?? "",
  model: bike.model ?? "",
  year: bike.year ? String(bike.year) : "",
  bikeType: bike.bikeType ?? "",
  colour: bike.colour ?? "",
  wheelSize: bike.wheelSize ?? "",
  frameSize: bike.frameSize ?? "",
  groupset: bike.groupset ?? "",
  motorBrand: bike.motorBrand ?? "",
  motorModel: bike.motorModel ?? "",
  batterySerial: bike.batterySerial ?? "",
  frameNumber: bike.frameNumber ?? "",
  serialNumber: bike.serialNumber ?? "",
  registrationNumber: bike.registrationNumber ?? "",
  notes: bike.notes ?? "",
});

const hasBikeIdentity = (form: BikeProfileFormState) =>
  [
    form.label,
    form.make,
    form.model,
    form.colour,
    form.frameNumber,
    form.serialNumber,
    form.registrationNumber,
  ].some((value) => value.trim().length > 0);

const hasEBikeDetails = (bike: Pick<
  CustomerBikeRecord,
  "bikeType" | "motorBrand" | "motorModel" | "batterySerial"
>) =>
  bike.bikeType === "E_BIKE" ||
  Boolean(bike.motorBrand || bike.motorModel || bike.batterySerial);

const shouldShowEBikeFields = (form: BikeProfileFormState, bike?: CustomerBikeRecord | null) =>
  form.bikeType === "E_BIKE" || Boolean(bike && hasEBikeDetails(bike));

const buildTechnicalSummary = (bike: CustomerBikeRecord) => {
  const parts = [
    bike.year ? String(bike.year) : null,
    bike.bikeType
      ? BIKE_TYPE_OPTIONS.find((option) => option.value === bike.bikeType)?.label ?? bike.bikeType
      : null,
    bike.frameSize || null,
    bike.wheelSize || null,
    bike.groupset || null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "No technical profile yet";
};

const buildEBikeSummary = (bike: CustomerBikeRecord) => {
  const parts = [bike.motorBrand, bike.motorModel, bike.batterySerial].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "No e-bike details recorded";
};

const requiresMileageRefresh = (schedule: BikeServiceScheduleRecord) =>
  schedule.intervalMileage !== null || schedule.nextDueMileage !== null;

export const CustomerProfilePage = () => {
  const { id } = useParams<{ id: string }>();
  const { success, error } = useToasts();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sales, setSales] = useState<CustomerSales["sales"]>([]);
  const [jobs, setJobs] = useState<CustomerWorkshopJob[]>([]);
  const [bikes, setBikes] = useState<CustomerBikeRecord[]>([]);
  const [communicationPreferences, setCommunicationPreferences] =
    useState<CustomerCommunicationPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingCommunicationPreferences, setSavingCommunicationPreferences] = useState(false);
  const [bikeEditorMode, setBikeEditorMode] = useState<"create" | "edit" | null>(null);
  const [editingBikeId, setEditingBikeId] = useState<string | null>(null);
  const [bikeForm, setBikeForm] = useState<BikeProfileFormState>(() => createEmptyBikeForm());
  const [bikeFormError, setBikeFormError] = useState<string | null>(null);
  const [savingBikeProfile, setSavingBikeProfile] = useState(false);
  const [scheduleEditorMode, setScheduleEditorMode] = useState<"create" | "edit" | null>(null);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState<BikeServiceScheduleFormState>(
    () => createEmptyScheduleForm(),
  );
  const [scheduleFormError, setScheduleFormError] = useState<string | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [refreshingScheduleId, setRefreshingScheduleId] = useState<string | null>(null);
  const [refreshScheduleForm, setRefreshScheduleForm] = useState<BikeServiceRefreshFormState>(
    () => createDefaultServiceRefreshForm(),
  );
  const [refreshScheduleError, setRefreshScheduleError] = useState<string | null>(null);
  const [savingScheduleRefresh, setSavingScheduleRefresh] = useState(false);

  const activeSaleId = useMemo(() => localStorage.getItem(ACTIVE_SALE_KEY), []);
  const editingBike = useMemo(
    () => bikes.find((bike) => bike.id === editingBikeId) ?? null,
    [bikes, editingBikeId],
  );
  const refreshingSchedule = useMemo(
    () =>
      editingBike?.serviceSchedules.find((schedule) => schedule.id === refreshingScheduleId)
      ?? null,
    [editingBike, refreshingScheduleId],
  );
  const showEBikeFields = shouldShowEBikeFields(bikeForm, editingBike);

  const loadProfile = async () => {
    if (!id) {
      return;
    }

    setLoading(true);
    try {
      const [customerPayload, salesPayload, jobsPayload, bikesPayload] = await Promise.all([
        apiGet<Customer>(`/api/customers/${encodeURIComponent(id)}`),
        apiGet<CustomerSales>(`/api/customers/${encodeURIComponent(id)}/sales`),
        apiGet<CustomerWorkshopJobs>(`/api/customers/${encodeURIComponent(id)}/workshop-jobs`),
        apiGet<CustomerBikesResponse>(`/api/customers/${encodeURIComponent(id)}/bikes`),
      ]);
      setCustomer(customerPayload);
      setCommunicationPreferences({
        emailAllowed: customerPayload.emailAllowed,
        smsAllowed: customerPayload.smsAllowed,
        whatsappAllowed: customerPayload.whatsappAllowed,
      });
      setSales(salesPayload.sales || []);
      setJobs(jobsPayload.workshopJobs || jobsPayload.jobs || []);
      setBikes(bikesPayload.bikes || []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load customer profile";
      error(message);
    } finally {
      setLoading(false);
    }
  };

  const communicationPreferencesDirty = Boolean(
    customer &&
      communicationPreferences &&
      (customer.emailAllowed !== communicationPreferences.emailAllowed ||
        customer.smsAllowed !== communicationPreferences.smsAllowed ||
        customer.whatsappAllowed !== communicationPreferences.whatsappAllowed),
  );

  const updateCommunicationPreference = (
    field: keyof CustomerCommunicationPreferences,
    value: boolean,
  ) => {
    setCommunicationPreferences((current) =>
      current
        ? {
            ...current,
            [field]: value,
          }
        : current,
    );
  };

  const saveCommunicationPreferences = async () => {
    if (!id || !communicationPreferences) {
      return;
    }

    setSavingCommunicationPreferences(true);
    try {
      const updatedCustomer = await apiPatch<Customer>(
        `/api/customers/${encodeURIComponent(id)}/communication-preferences`,
        communicationPreferences,
      );
      setCustomer(updatedCustomer);
      setCommunicationPreferences({
        emailAllowed: updatedCustomer.emailAllowed,
        smsAllowed: updatedCustomer.smsAllowed,
        whatsappAllowed: updatedCustomer.whatsappAllowed,
      });
      success("Customer communication settings saved.");
    } catch (saveError) {
      const message =
        saveError instanceof Error
          ? saveError.message
          : "Failed to save customer communication settings";
      error(message);
    } finally {
      setSavingCommunicationPreferences(false);
    }
  };

  useEffect(() => {
    void loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const attachToActiveSale = async () => {
    if (!id || !activeSaleId) {
      error("No active POS sale found.");
      return;
    }

    try {
      await apiPatch(`/api/sales/${encodeURIComponent(activeSaleId)}/customer`, {
        customerId: id,
      });
      success(`Customer attached to active sale ${activeSaleId.slice(0, 8)}.`);
    } catch (attachError) {
      const message = attachError instanceof Error ? attachError.message : "Failed to attach customer";
      error(message);
    }
  };

  const updateBikeForm = (field: keyof BikeProfileFormState, value: string) => {
    setBikeForm((current) => ({
      ...current,
      [field]: value,
    }));
    setBikeFormError(null);
  };

  const openCreateBikeEditor = () => {
    setBikeEditorMode("create");
    setEditingBikeId(null);
    setBikeForm(createEmptyBikeForm());
    setBikeFormError(null);
    setScheduleEditorMode(null);
    setEditingScheduleId(null);
    setScheduleForm(createEmptyScheduleForm());
    setScheduleFormError(null);
    setRefreshingScheduleId(null);
    setRefreshScheduleForm(createDefaultServiceRefreshForm());
    setRefreshScheduleError(null);
  };

  const openEditBikeEditor = (bike: CustomerBikeRecord) => {
    setBikeEditorMode("edit");
    setEditingBikeId(bike.id);
    setBikeForm(toBikeFormState(bike));
    setBikeFormError(null);
    setScheduleEditorMode(null);
    setEditingScheduleId(null);
    setScheduleForm(createEmptyScheduleForm());
    setScheduleFormError(null);
    setRefreshingScheduleId(null);
    setRefreshScheduleForm(createDefaultServiceRefreshForm());
    setRefreshScheduleError(null);
  };

  const closeBikeEditor = () => {
    setBikeEditorMode(null);
    setEditingBikeId(null);
    setBikeForm(createEmptyBikeForm());
    setBikeFormError(null);
    setScheduleEditorMode(null);
    setEditingScheduleId(null);
    setScheduleForm(createEmptyScheduleForm());
    setScheduleFormError(null);
    setRefreshingScheduleId(null);
    setRefreshScheduleForm(createDefaultServiceRefreshForm());
    setRefreshScheduleError(null);
  };

  const updateScheduleForm = (
    field: keyof BikeServiceScheduleFormState,
    value: string | boolean,
  ) => {
    setScheduleForm((current) => {
      if (field !== "type" || typeof value !== "string") {
        return {
          ...current,
          [field]: value,
        } as BikeServiceScheduleFormState;
      }

      const nextType = value as BikeServiceScheduleType;
      const currentDefaultTitle = defaultBikeServiceScheduleTitle(current.type);
      const nextDefaultTitle = defaultBikeServiceScheduleTitle(nextType);

      return {
        ...current,
        type: nextType,
        title:
          current.title.trim().length === 0 || current.title === currentDefaultTitle
            ? nextDefaultTitle
            : current.title,
      };
    });
    setScheduleFormError(null);
  };

  const openCreateScheduleEditor = () => {
    setScheduleEditorMode("create");
    setEditingScheduleId(null);
    setScheduleForm(createEmptyScheduleForm());
    setScheduleFormError(null);
  };

  const openEditScheduleEditor = (schedule: BikeServiceScheduleRecord) => {
    setScheduleEditorMode("edit");
    setEditingScheduleId(schedule.id);
    setScheduleForm(toScheduleFormState(schedule));
    setScheduleFormError(null);
  };

  const closeScheduleEditor = () => {
    setScheduleEditorMode(null);
    setEditingScheduleId(null);
    setScheduleForm(createEmptyScheduleForm());
    setScheduleFormError(null);
  };

  const openRefreshScheduleForm = (schedule: BikeServiceScheduleRecord) => {
    setRefreshingScheduleId(schedule.id);
    setRefreshScheduleForm({
      servicedAt: toDateInputValue(new Date()),
      servicedMileage:
        schedule.lastServiceMileage !== null ? String(schedule.lastServiceMileage) : "",
    });
    setRefreshScheduleError(null);
  };

  const closeRefreshScheduleForm = () => {
    setRefreshingScheduleId(null);
    setRefreshScheduleForm(createDefaultServiceRefreshForm());
    setRefreshScheduleError(null);
  };

  const saveBikeProfile = async () => {
    if (!id) {
      return;
    }

    if (!hasBikeIdentity(bikeForm)) {
      setBikeFormError("Add at least one identity field so the bike can be recognised later.");
      return;
    }

    const trimmedYear = bikeForm.year.trim();
    let year: number | undefined;
    if (trimmedYear) {
      const parsedYear = Number(trimmedYear);
      if (!Number.isInteger(parsedYear)) {
        setBikeFormError("Year must be a whole number.");
        return;
      }
      if (parsedYear < CUSTOMER_BIKE_YEAR_MIN || parsedYear > CUSTOMER_BIKE_YEAR_MAX) {
        setBikeFormError(
          `Year must be between ${CUSTOMER_BIKE_YEAR_MIN} and ${CUSTOMER_BIKE_YEAR_MAX}.`,
        );
        return;
      }
      year = parsedYear;
    }

    const payload = {
      label: bikeForm.label || undefined,
      make: bikeForm.make || undefined,
      model: bikeForm.model || undefined,
      year,
      bikeType: bikeForm.bikeType || undefined,
      colour: bikeForm.colour || undefined,
      wheelSize: bikeForm.wheelSize || undefined,
      frameSize: bikeForm.frameSize || undefined,
      groupset: bikeForm.groupset || undefined,
      motorBrand: showEBikeFields ? bikeForm.motorBrand || undefined : undefined,
      motorModel: showEBikeFields ? bikeForm.motorModel || undefined : undefined,
      batterySerial: showEBikeFields ? bikeForm.batterySerial || undefined : undefined,
      frameNumber: bikeForm.frameNumber || undefined,
      serialNumber: bikeForm.serialNumber || undefined,
      registrationNumber: bikeForm.registrationNumber || undefined,
      notes: bikeForm.notes || undefined,
    };

    setSavingBikeProfile(true);
    setBikeFormError(null);
    try {
      if (bikeEditorMode === "edit" && editingBikeId) {
        await apiPatch<{ bike: CustomerBikeRecord }>(
          `/api/customers/bikes/${encodeURIComponent(editingBikeId)}`,
          payload,
        );
        success("Bike profile updated.");
      } else {
        await apiPost<{ bike: CustomerBikeRecord }>(
          `/api/customers/${encodeURIComponent(id)}/bikes`,
          payload,
        );
        success("Bike record created.");
      }

      await loadProfile();
      closeBikeEditor();
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Failed to save bike profile";
      setBikeFormError(message);
      error(message);
    } finally {
      setSavingBikeProfile(false);
    }
  };

  const saveBikeServiceSchedule = async () => {
    if (!editingBike) {
      return;
    }

    if (!scheduleForm.title.trim()) {
      setScheduleFormError("Schedule title is required.");
      return;
    }

    const parseOptionalPositiveInteger = (value: string, fieldLabel: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return undefined;
      }

      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${fieldLabel} must be a positive whole number.`);
      }

      return parsed;
    };

    const parseOptionalMileageInteger = (value: string, fieldLabel: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return undefined;
      }

      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${fieldLabel} must be zero or a positive whole number.`);
      }

      return parsed;
    };

    let intervalMonths: number | undefined;
    let intervalMileage: number | undefined;
    let lastServiceMileage: number | undefined;
    let nextDueMileage: number | undefined;

    try {
      intervalMonths = parseOptionalPositiveInteger(scheduleForm.intervalMonths, "Interval months");
      intervalMileage = parseOptionalPositiveInteger(scheduleForm.intervalMileage, "Interval mileage");
      lastServiceMileage = parseOptionalMileageInteger(
        scheduleForm.lastServiceMileage,
        "Last service mileage",
      );
      nextDueMileage = parseOptionalMileageInteger(
        scheduleForm.nextDueMileage,
        "Next due mileage",
      );
    } catch (validationError) {
      const message =
        validationError instanceof Error
          ? validationError.message
          : "Check the service schedule values and try again.";
      setScheduleFormError(message);
      return;
    }

    const payload = {
      type: scheduleForm.type,
      title: scheduleForm.title.trim(),
      description: scheduleForm.description.trim() || undefined,
      intervalMonths,
      intervalMileage,
      lastServiceAt: scheduleForm.lastServiceAt || undefined,
      lastServiceMileage,
      nextDueAt: scheduleForm.nextDueAt || undefined,
      nextDueMileage,
      isActive: scheduleForm.isActive,
    };

    setSavingSchedule(true);
    setScheduleFormError(null);
    try {
      if (scheduleEditorMode === "edit" && editingScheduleId) {
        await apiPatch(
          `/api/customers/bikes/${encodeURIComponent(editingBike.id)}/service-schedules/${encodeURIComponent(editingScheduleId)}`,
          payload,
        );
        success("Bike service schedule updated.");
      } else {
        await apiPost(
          `/api/customers/bikes/${encodeURIComponent(editingBike.id)}/service-schedules`,
          payload,
        );
        success("Bike service schedule created.");
      }

      await loadProfile();
      closeScheduleEditor();
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Failed to save bike service schedule";
      setScheduleFormError(message);
      error(message);
    } finally {
      setSavingSchedule(false);
    }
  };

  const refreshBikeServiceSchedule = async () => {
    if (!editingBike || !refreshingScheduleId || !refreshingSchedule) {
      return;
    }

    const trimmedMileage = refreshScheduleForm.servicedMileage.trim();
    if (requiresMileageRefresh(refreshingSchedule) && !trimmedMileage) {
      setRefreshScheduleError("Mileage is required to refresh a mileage-based service schedule.");
      return;
    }

    let servicedMileage: number | undefined;
    if (trimmedMileage) {
      const parsed = Number(trimmedMileage);
      if (!Number.isInteger(parsed) || parsed < 0) {
        setRefreshScheduleError("Mileage must be zero or a positive whole number.");
        return;
      }
      servicedMileage = parsed;
    }

    setSavingScheduleRefresh(true);
    setRefreshScheduleError(null);
    try {
      await apiPost(
        `/api/customers/bikes/${encodeURIComponent(editingBike.id)}/service-schedules/${encodeURIComponent(refreshingScheduleId)}/mark-serviced`,
        {
          servicedAt: refreshScheduleForm.servicedAt || undefined,
          servicedMileage,
        },
      );
      success("Bike service schedule refreshed from the latest service.");
      await loadProfile();
      closeRefreshScheduleForm();
    } catch (refreshError) {
      const message =
        refreshError instanceof Error
          ? refreshError.message
          : "Failed to refresh bike service schedule";
      setRefreshScheduleError(message);
      error(message);
    } finally {
      setSavingScheduleRefresh(false);
    }
  };

  if (!id) {
    return <div className="page-shell"><p>Missing customer id.</p></div>;
  }

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <h1>Customer Profile</h1>
          <Link to="/customers">Back to Customers</Link>
        </div>

        {loading ? <p>Loading...</p> : null}

        {customer ? (
          <>
            <div className="job-meta-grid">
              <div><strong>Name:</strong> {customer.name}</div>
              <div><strong>Email:</strong> {customer.email || "-"}</div>
              <div><strong>Phone:</strong> {customer.phone || "-"}</div>
              <div><strong>Notes:</strong> {customer.notes || "-"}</div>
            </div>

            {communicationPreferences ? (
              <div style={{ marginTop: "16px" }}>
                <h2 style={{ fontSize: "1rem", marginBottom: "8px" }}>Workshop Updates</h2>
                <p className="muted-text">
                  Staff-controlled permissions for operational quote, collection, and workshop updates.
                </p>
                <div
                  style={{
                    display: "grid",
                    gap: "10px",
                    marginTop: "12px",
                  }}
                >
                  <label className="staff-toggle">
                    <input
                      type="checkbox"
                      checked={communicationPreferences.emailAllowed}
                      disabled={savingCommunicationPreferences}
                      onChange={(event) =>
                        updateCommunicationPreference("emailAllowed", event.target.checked)
                      }
                    />
                    <span>Email updates</span>
                  </label>
                  <label className="staff-toggle">
                    <input
                      type="checkbox"
                      checked={communicationPreferences.smsAllowed}
                      disabled={savingCommunicationPreferences}
                      onChange={(event) =>
                        updateCommunicationPreference("smsAllowed", event.target.checked)
                      }
                    />
                    <span>SMS updates</span>
                  </label>
                  <label className="staff-toggle">
                    <input
                      type="checkbox"
                      checked={communicationPreferences.whatsappAllowed}
                      disabled={savingCommunicationPreferences}
                      onChange={(event) =>
                        updateCommunicationPreference("whatsappAllowed", event.target.checked)
                      }
                    />
                    <span>WhatsApp updates</span>
                  </label>
                </div>
                <div className="actions-inline" style={{ marginTop: "10px" }}>
                  <button
                    type="button"
                    onClick={saveCommunicationPreferences}
                    disabled={!communicationPreferencesDirty || savingCommunicationPreferences}
                  >
                    {savingCommunicationPreferences ? "Saving..." : "Save Communication Settings"}
                  </button>
                  <span className="muted-text">
                    {communicationPreferencesDirty
                      ? "Unsaved changes"
                      : "Saved customer communication settings"}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="actions-inline" style={{ marginTop: "10px" }}>
              <button type="button" onClick={attachToActiveSale} disabled={!activeSaleId}>
                Attach To Active POS Sale
              </button>
              <Link to={`/customers/${customer.id}/timeline`} className="button-link">
                Open Timeline
              </Link>
              <span className="muted-text">
                {activeSaleId ? `Active sale: ${activeSaleId.slice(0, 8)}` : "No active POS sale in this browser."}
              </span>
            </div>
          </>
        ) : null}
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Bike Records</h2>
            <p className="muted-text">
              Keep a reusable bike profile ready for service history, workshop intake, and quote context.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={openCreateBikeEditor}>
              Add Bike Record
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bike</th>
                <th>Identity</th>
                <th>Service Lifecycle</th>
                <th>Linked Jobs</th>
                <th>Latest Linked Service</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bikes.length === 0 ? (
                <tr>
                  <td colSpan={6}>No bike records linked to this customer yet.</td>
                </tr>
              ) : (
                bikes.map((bike) => (
                  <tr key={bike.id}>
                    <td>
                      <div className="table-primary">
                        <Link to={`/customers/bikes/${bike.id}`}>{bike.displayName}</Link>
                      </div>
                      <div className="table-secondary">
                        {bike.notes || "Reusable bike record for workshop history and intake"}
                      </div>
                    </td>
                    <td>
                      {[bike.make, bike.model].filter(Boolean).join(" ") || "-"}
                      <div className="table-secondary">
                        {bike.registrationNumber || bike.frameNumber || bike.serialNumber || "No identifier recorded"}
                      </div>
                      <div className="table-secondary">{buildTechnicalSummary(bike)}</div>
                      {hasEBikeDetails(bike) ? (
                        <div className="table-secondary">{buildEBikeSummary(bike)}</div>
                      ) : null}
                    </td>
                    <td>
                      {bike.serviceScheduleSummary.activeCount === 0 ? (
                        <span className="table-secondary">No active service schedules</span>
                      ) : (
                        <div className="bike-service-schedule-inline-list">
                          {bike.serviceSchedules
                            .filter((schedule) => schedule.isActive)
                            .slice(0, 2)
                            .map((schedule) => (
                              <div key={schedule.id} className="bike-service-schedule-inline-item">
                                <div className="actions-inline">
                                  <strong>{schedule.title}</strong>
                                  <span className={bikeServiceScheduleDueStatusClass(schedule.dueStatus)}>
                                    {bikeServiceScheduleDueStatusLabel(schedule.dueStatus)}
                                  </span>
                                </div>
                                <div className="table-secondary">{schedule.dueSummaryText}</div>
                              </div>
                            ))}
                        </div>
                      )}
                      <div className="table-secondary">
                        {bike.serviceScheduleSummary.activeCount} active · {bike.serviceScheduleSummary.dueCount} due · {bike.serviceScheduleSummary.overdueCount} overdue
                      </div>
                    </td>
                    <td>
                      {bike.serviceSummary.linkedJobCount}
                      <div className="table-secondary">
                        {bike.serviceSummary.openJobCount} open / {bike.serviceSummary.completedJobCount} completed
                      </div>
                    </td>
                    <td>{formatOptionalDateTime(bike.serviceSummary.latestJobAt)}</td>
                    <td>
                      <div className="actions-inline">
                        <Link to={`/customers/bikes/${bike.id}`}>Service History</Link>
                        <button type="button" onClick={() => openEditBikeEditor(bike)}>
                          View / Edit Profile
                        </button>
                        <Link to={`/workshop/check-in?bikeId=${encodeURIComponent(bike.id)}`}>Start Workshop Job</Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {bikeEditorMode ? (
          <div className="bike-profile-editor">
            <div className="card-header-row">
              <div>
                <h3 style={{ margin: 0 }}>
                  {bikeEditorMode === "edit" ? "Edit Bike Profile" : "Add Bike Record"}
                </h3>
                <p className="muted-text" style={{ margin: "6px 0 0" }}>
                  Keep identity details compact, then add technical and e-bike data only where it helps workshop staff.
                </p>
              </div>
              <div className="actions-inline">
                {editingBike ? (
                  <Link to={`/customers/bikes/${editingBike.id}`} className="button-link">
                    Open Service History
                  </Link>
                ) : null}
                <button type="button" onClick={closeBikeEditor} disabled={savingBikeProfile}>
                  Cancel
                </button>
              </div>
            </div>

            <div className="bike-profile-section">
              <h4>Identity</h4>
              <div className="bike-profile-grid">
                <label>
                  <span>Label</span>
                  <input
                    type="text"
                    value={bikeForm.label}
                    onChange={(event) => updateBikeForm("label", event.target.value)}
                    placeholder="Commuter, race bike, junior MTB"
                    disabled={savingBikeProfile}
                  />
                </label>
                <label>
                  <span>Make</span>
                  <input
                    type="text"
                    value={bikeForm.make}
                    onChange={(event) => updateBikeForm("make", event.target.value)}
                    disabled={savingBikeProfile}
                  />
                </label>
                <label>
                  <span>Model</span>
                  <input
                    type="text"
                    value={bikeForm.model}
                    onChange={(event) => updateBikeForm("model", event.target.value)}
                    disabled={savingBikeProfile}
                  />
                </label>
                <label>
                  <span>Colour</span>
                  <input
                    type="text"
                    value={bikeForm.colour}
                    onChange={(event) => updateBikeForm("colour", event.target.value)}
                    disabled={savingBikeProfile}
                  />
                </label>
                <label>
                  <span>Frame number</span>
                  <input
                    type="text"
                    value={bikeForm.frameNumber}
                    onChange={(event) => updateBikeForm("frameNumber", event.target.value)}
                    disabled={savingBikeProfile}
                  />
                </label>
                <label>
                  <span>Serial number</span>
                  <input
                    type="text"
                    value={bikeForm.serialNumber}
                    onChange={(event) => updateBikeForm("serialNumber", event.target.value)}
                    disabled={savingBikeProfile}
                  />
                </label>
                <label>
                  <span>Registration</span>
                  <input
                    type="text"
                    value={bikeForm.registrationNumber}
                    onChange={(event) => updateBikeForm("registrationNumber", event.target.value)}
                    disabled={savingBikeProfile}
                  />
                </label>
              </div>
            </div>

            <div className="bike-profile-section">
              <h4>Technical Details</h4>
              <div className="bike-profile-grid">
                <label>
                  <span>Year</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={CUSTOMER_BIKE_YEAR_MIN}
                    max={CUSTOMER_BIKE_YEAR_MAX}
                    value={bikeForm.year}
                    onChange={(event) => updateBikeForm("year", event.target.value)}
                    disabled={savingBikeProfile}
                  />
                </label>
                <label>
                  <span>Bike type</span>
                  <select
                    value={bikeForm.bikeType}
                    onChange={(event) => updateBikeForm("bikeType", event.target.value)}
                    disabled={savingBikeProfile}
                  >
                    <option value="">Select bike type</option>
                    {BIKE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Wheel size</span>
                  <input
                    type="text"
                    value={bikeForm.wheelSize}
                    onChange={(event) => updateBikeForm("wheelSize", event.target.value)}
                    placeholder="700c, 29in"
                    disabled={savingBikeProfile}
                  />
                </label>
                <label>
                  <span>Frame size</span>
                  <input
                    type="text"
                    value={bikeForm.frameSize}
                    onChange={(event) => updateBikeForm("frameSize", event.target.value)}
                    placeholder="54cm, Medium"
                    disabled={savingBikeProfile}
                  />
                </label>
                <label>
                  <span>Groupset</span>
                  <input
                    type="text"
                    value={bikeForm.groupset}
                    onChange={(event) => updateBikeForm("groupset", event.target.value)}
                    disabled={savingBikeProfile}
                  />
                </label>
              </div>
            </div>

            {showEBikeFields ? (
              <div className="bike-profile-section">
                <h4>E-bike Details</h4>
                <div className="bike-profile-grid">
                  <label>
                    <span>Motor brand</span>
                    <input
                      type="text"
                      value={bikeForm.motorBrand}
                      onChange={(event) => updateBikeForm("motorBrand", event.target.value)}
                      disabled={savingBikeProfile}
                    />
                  </label>
                  <label>
                    <span>Motor model</span>
                    <input
                      type="text"
                      value={bikeForm.motorModel}
                      onChange={(event) => updateBikeForm("motorModel", event.target.value)}
                      disabled={savingBikeProfile}
                    />
                  </label>
                  <label>
                    <span>Battery serial</span>
                    <input
                      type="text"
                      value={bikeForm.batterySerial}
                      onChange={(event) => updateBikeForm("batterySerial", event.target.value)}
                      disabled={savingBikeProfile}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            <div className="bike-profile-section">
              <h4>Notes</h4>
              <label className="bike-profile-notes">
                <span>Workshop-facing notes</span>
                <textarea
                  value={bikeForm.notes}
                  onChange={(event) => updateBikeForm("notes", event.target.value)}
                  rows={3}
                  disabled={savingBikeProfile}
                />
              </label>
            </div>

            {bikeEditorMode === "edit" && editingBike ? (
              <div className="bike-profile-section">
                <div className="card-header-row">
                  <div>
                    <h4>Service Lifecycle</h4>
                    <p className="muted-text" style={{ margin: "6px 0 0" }}>
                      Track what is due next for this bike without guessing from old workshop lines.
                    </p>
                  </div>
                  <div className="actions-inline">
                    <button type="button" onClick={openCreateScheduleEditor} disabled={savingSchedule}>
                      Add Service Schedule
                    </button>
                  </div>
                </div>

                {editingBike.serviceSchedules.length === 0 ? (
                  <div className="restricted-panel">
                    No service schedules yet. Add one to start tracking what this bike is due for next.
                  </div>
                ) : (
                  <div className="bike-service-schedule-list">
                    {editingBike.serviceSchedules.map((schedule) => (
                      <article key={schedule.id} className="bike-service-schedule-card">
                        <div className="card-header-row">
                          <div>
                            <div className="actions-inline">
                              <strong>{schedule.title}</strong>
                              <span className={bikeServiceScheduleDueStatusClass(schedule.dueStatus)}>
                                {bikeServiceScheduleDueStatusLabel(schedule.dueStatus)}
                              </span>
                            </div>
                            <div className="table-secondary">
                              {schedule.typeLabel} · {schedule.cadenceSummaryText}
                            </div>
                          </div>
                          <div className="actions-inline">
                            <button
                              type="button"
                              onClick={() => openEditScheduleEditor(schedule)}
                              disabled={savingSchedule || savingScheduleRefresh}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => openRefreshScheduleForm(schedule)}
                              disabled={savingSchedule || savingScheduleRefresh}
                            >
                              Mark Serviced
                            </button>
                          </div>
                        </div>

                        <div className="bike-service-schedule-card__meta">
                          <div><strong>Next due:</strong> {schedule.dueSummaryText}</div>
                          <div><strong>Last service:</strong> {schedule.lastServiceSummaryText}</div>
                          <div><strong>Status:</strong> {schedule.isActive ? "Active" : "Inactive"}</div>
                          <div><strong>Updated:</strong> {formatOptionalDateTime(schedule.updatedAt)}</div>
                        </div>

                        {schedule.description ? (
                          <div className="table-secondary">{schedule.description}</div>
                        ) : null}

                        {refreshingScheduleId === schedule.id ? (
                          <div className="bike-service-schedule-refresh">
                            <div className="bike-profile-grid">
                              <label>
                                <span>Service date</span>
                                <input
                                  type="date"
                                  value={refreshScheduleForm.servicedAt}
                                  onChange={(event) =>
                                    setRefreshScheduleForm((current) => ({
                                      ...current,
                                      servicedAt: event.target.value,
                                    }))
                                  }
                                  disabled={savingScheduleRefresh}
                                />
                              </label>
                              <label>
                                <span>Service mileage</span>
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  value={refreshScheduleForm.servicedMileage}
                                  onChange={(event) =>
                                    setRefreshScheduleForm((current) => ({
                                      ...current,
                                      servicedMileage: event.target.value,
                                    }))
                                  }
                                  placeholder={
                                    requiresMileageRefresh(schedule)
                                      ? "Required for mileage cadence"
                                      : "Optional"
                                  }
                                  disabled={savingScheduleRefresh}
                                />
                              </label>
                            </div>
                            {refreshScheduleError ? (
                              <p className="inventory-adjustment-validation">{refreshScheduleError}</p>
                            ) : null}
                            <div className="actions-inline">
                              <button
                                type="button"
                                onClick={refreshBikeServiceSchedule}
                                disabled={savingScheduleRefresh}
                              >
                                {savingScheduleRefresh ? "Refreshing..." : "Refresh Next Due"}
                              </button>
                              <button
                                type="button"
                                onClick={closeRefreshScheduleForm}
                                disabled={savingScheduleRefresh}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}

                {scheduleEditorMode ? (
                  <div className="bike-service-schedule-editor">
                    <div className="card-header-row">
                      <div>
                        <h4 style={{ margin: 0 }}>
                          {scheduleEditorMode === "edit" ? "Edit Service Schedule" : "Add Service Schedule"}
                        </h4>
                        <p className="muted-text" style={{ margin: "6px 0 0" }}>
                          Keep schedules explicit so workshop staff can see what this bike is due for next.
                        </p>
                      </div>
                      <button type="button" onClick={closeScheduleEditor} disabled={savingSchedule}>
                        Cancel
                      </button>
                    </div>

                    <div className="bike-profile-grid">
                      <label>
                        <span>Schedule type</span>
                        <select
                          value={scheduleForm.type}
                          onChange={(event) =>
                            updateScheduleForm("type", event.target.value as BikeServiceScheduleType)
                          }
                          disabled={savingSchedule}
                        >
                          {BIKE_SERVICE_SCHEDULE_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Title</span>
                        <input
                          type="text"
                          value={scheduleForm.title}
                          onChange={(event) => updateScheduleForm("title", event.target.value)}
                          disabled={savingSchedule}
                        />
                      </label>
                      <label>
                        <span>Interval months</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={scheduleForm.intervalMonths}
                          onChange={(event) => updateScheduleForm("intervalMonths", event.target.value)}
                          placeholder="12"
                          disabled={savingSchedule}
                        />
                      </label>
                      <label>
                        <span>Interval mileage</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={scheduleForm.intervalMileage}
                          onChange={(event) => updateScheduleForm("intervalMileage", event.target.value)}
                          placeholder="3000"
                          disabled={savingSchedule}
                        />
                      </label>
                      <label>
                        <span>Last service date</span>
                        <input
                          type="date"
                          value={scheduleForm.lastServiceAt}
                          onChange={(event) => updateScheduleForm("lastServiceAt", event.target.value)}
                          disabled={savingSchedule}
                        />
                      </label>
                      <label>
                        <span>Last service mileage</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={scheduleForm.lastServiceMileage}
                          onChange={(event) => updateScheduleForm("lastServiceMileage", event.target.value)}
                          disabled={savingSchedule}
                        />
                      </label>
                      <label>
                        <span>Next due date</span>
                        <input
                          type="date"
                          value={scheduleForm.nextDueAt}
                          onChange={(event) => updateScheduleForm("nextDueAt", event.target.value)}
                          disabled={savingSchedule}
                        />
                      </label>
                      <label>
                        <span>Next due mileage</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={scheduleForm.nextDueMileage}
                          onChange={(event) => updateScheduleForm("nextDueMileage", event.target.value)}
                          disabled={savingSchedule}
                        />
                      </label>
                      <label className="staff-toggle">
                        <input
                          type="checkbox"
                          checked={scheduleForm.isActive}
                          onChange={(event) => updateScheduleForm("isActive", event.target.checked)}
                          disabled={savingSchedule}
                        />
                        <span>Active schedule</span>
                      </label>
                    </div>

                    <label className="bike-profile-notes">
                      <span>Description</span>
                      <textarea
                        value={scheduleForm.description}
                        onChange={(event) => updateScheduleForm("description", event.target.value)}
                        rows={2}
                        disabled={savingSchedule}
                      />
                    </label>

                    {scheduleFormError ? (
                      <p className="inventory-adjustment-validation">{scheduleFormError}</p>
                    ) : null}

                    <div className="actions-inline">
                      <button type="button" onClick={saveBikeServiceSchedule} disabled={savingSchedule}>
                        {savingSchedule
                          ? scheduleEditorMode === "edit"
                            ? "Saving..."
                            : "Creating..."
                          : scheduleEditorMode === "edit"
                            ? "Save Service Schedule"
                            : "Create Service Schedule"}
                      </button>
                      <button type="button" onClick={closeScheduleEditor} disabled={savingSchedule}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : bikeEditorMode === "create" ? (
              <div className="restricted-panel">
                Save the bike record first, then add service schedules for what this bike should be due next.
              </div>
            ) : null}

            {bikeFormError ? <p className="inventory-adjustment-validation">{bikeFormError}</p> : null}

            <div className="actions-inline" style={{ marginTop: "12px" }}>
              <button type="button" onClick={saveBikeProfile} disabled={savingBikeProfile}>
                {savingBikeProfile
                  ? bikeEditorMode === "edit"
                    ? "Saving..."
                    : "Creating..."
                  : bikeEditorMode === "edit"
                    ? "Save Bike Profile"
                    : "Create Bike Record"}
              </button>
              <button type="button" onClick={closeBikeEditor} disabled={savingBikeProfile}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>Sales History</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sale</th>
                <th>Total</th>
                <th>Completed</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 ? (
                <tr>
                  <td colSpan={4}>No sales found.</td>
                </tr>
              ) : (
                sales.map((sale) => (
                  <tr key={sale.id}>
                    <td>{sale.id.slice(0, 8)}</td>
                    <td>{formatMoney(sale.totalPence)}</td>
                    <td>{sale.completedAt ? new Date(sale.completedAt).toLocaleString() : "-"}</td>
                    <td>
                      {sale.receiptNumber ? (
                        <a href={toBackendUrl(`/r/${encodeURIComponent(sale.receiptNumber)}`)} target="_blank" rel="noreferrer">
                          View Receipt
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="actions-inline" style={{ marginTop: "10px" }}>
          <Link to={`/customers/${id}/timeline`}>Open full timeline</Link>
        </div>
      </section>

      <section className="card">
        <h2>Workshop History</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Bike</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={4}>No workshop jobs found.</td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <Link to={`/workshop/${job.id}`}>{job.id.slice(0, 8)}</Link>
                    </td>
                    <td>
                      <span className={workshopExecutionStatusClass(job.status, job.rawStatus)}>
                        {workshopExecutionStatusLabel(job.status)}
                      </span>
                      <div className="table-secondary">{workshopRawStatusLabel(job.rawStatus)}</div>
                    </td>
                    <td>
                      {job.bikeId ? (
                        <Link to={`/customers/bikes/${job.bikeId}`}>{job.bikeDescription || "Linked bike"}</Link>
                      ) : (
                        job.bikeDescription || "-"
                      )}
                    </td>
                    <td>{new Date(job.updatedAt).toLocaleString()}</td>
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
