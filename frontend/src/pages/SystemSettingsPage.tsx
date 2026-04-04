import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { invalidateAppConfigCache } from "../config/appConfig";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SurfaceCard } from "../components/ui/SurfaceCard";

const STORE_WEEKDAYS = [
  { key: "MONDAY", label: "Monday" },
  { key: "TUESDAY", label: "Tuesday" },
  { key: "WEDNESDAY", label: "Wednesday" },
  { key: "THURSDAY", label: "Thursday" },
  { key: "FRIDAY", label: "Friday" },
  { key: "SATURDAY", label: "Saturday" },
  { key: "SUNDAY", label: "Sunday" },
] as const;

type StoreWeekdayKey = typeof STORE_WEEKDAYS[number]["key"];

type StoreDailyOpeningHours = {
  isClosed: boolean;
  opensAt: string;
  closesAt: string;
};

type StoreOpeningHours = Record<StoreWeekdayKey, StoreDailyOpeningHours>;

const DEFAULT_OPENING_HOURS: StoreOpeningHours = {
  MONDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  TUESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  WEDNESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  THURSDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  FRIDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  SATURDAY: { isClosed: false, opensAt: "09:00", closesAt: "16:30" },
  SUNDAY: { isClosed: true, opensAt: "", closesAt: "" },
};

type StoreInfo = {
  name: string;
  businessName: string;
  email: string;
  phone: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postcode: string;
  country: string;
  vatNumber: string;
  companyNumber: string;
  defaultCurrency: string;
  timeZone: string;
  logoUrl: string;
  uploadedLogoPath: string;
  footerText: string;
  openingHours: StoreOpeningHours;
};

type StoreInfoResponse = {
  store: StoreInfo & {
    preferredLogoUrl?: string;
  };
};

type WorkshopCommercialSettings = {
  commercialSuggestionsEnabled: boolean;
  commercialLongGapDays: number;
  commercialRecentServiceCooldownDays: number;
};

type SettingsResponse = {
  settings: {
    workshop: WorkshopCommercialSettings;
  };
};

type RegisteredPrinterTransportMode = "DRY_RUN" | "RAW_TCP";

type RegisteredPrinter = {
  id: string;
  name: string;
  key: string;
  printerFamily: "ZEBRA_LABEL";
  printerModelHint: "GK420D_OR_COMPATIBLE";
  supportsShippingLabels: boolean;
  isActive: boolean;
  transportMode: RegisteredPrinterTransportMode;
  rawTcpHost: string | null;
  rawTcpPort: number | null;
  location: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  isDefaultShippingLabelPrinter: boolean;
};

type RegisteredPrinterListResponse = {
  printers: RegisteredPrinter[];
  defaultShippingLabelPrinterId: string | null;
  defaultShippingLabelPrinter: RegisteredPrinter | null;
};

type PrinterMutationResponse = {
  printer: RegisteredPrinter;
  defaultShippingLabelPrinterId: string | null;
};

type DefaultShippingLabelPrinterResponse = {
  defaultShippingLabelPrinterId: string | null;
  defaultShippingLabelPrinter: RegisteredPrinter | null;
};

type PrinterFormState = {
  name: string;
  key: string;
  printerFamily: "ZEBRA_LABEL";
  printerModelHint: "GK420D_OR_COMPATIBLE";
  supportsShippingLabels: boolean;
  isActive: boolean;
  transportMode: RegisteredPrinterTransportMode;
  rawTcpHost: string;
  rawTcpPort: string;
  location: string;
  notes: string;
  setAsDefaultShippingLabel: boolean;
};

const DEFAULT_WORKSHOP_COMMERCIAL_SETTINGS: WorkshopCommercialSettings = {
  commercialSuggestionsEnabled: true,
  commercialLongGapDays: 180,
  commercialRecentServiceCooldownDays: 60,
};

const DEFAULT_PRINTER_FORM: PrinterFormState = {
  name: "",
  key: "",
  printerFamily: "ZEBRA_LABEL",
  printerModelHint: "GK420D_OR_COMPATIBLE",
  supportsShippingLabels: true,
  isActive: true,
  transportMode: "DRY_RUN",
  rawTcpHost: "",
  rawTcpPort: "9100",
  location: "",
  notes: "",
  setAsDefaultShippingLabel: false,
};

const COMMON_TIME_ZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
];

const COMMON_CURRENCIES = ["GBP", "EUR", "USD", "AUD", "CAD"];

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidUrl = (value: string) => {
  if (!value.trim()) {
    return true;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const normalizeTextInput = (value: string) => value.replace(/\s+/g, " ").trim();
const normalizePostcodeInput = (value: string) => value.replace(/\s+/g, " ").trim().toUpperCase();
const normalizeOpeningHoursTime = (value: string) => value.trim();

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Failed to read logo image"));
    };
    reader.onerror = () => reject(new Error("Failed to read logo image"));
    reader.readAsDataURL(file);
  });

const normalizeOpeningHours = (openingHours: StoreOpeningHours): StoreOpeningHours =>
  STORE_WEEKDAYS.reduce((result, weekday) => {
    const day = openingHours[weekday.key];
    result[weekday.key] = day.isClosed
      ? { isClosed: true, opensAt: "", closesAt: "" }
      : {
        isClosed: false,
        opensAt: normalizeOpeningHoursTime(day.opensAt),
        closesAt: normalizeOpeningHoursTime(day.closesAt),
      };
    return result;
  }, {} as StoreOpeningHours);

const normalizeFormBeforeSave = (
  store: StoreInfo,
): Omit<StoreInfo, "uploadedLogoPath"> => ({
  name: normalizeTextInput(store.name),
  businessName: normalizeTextInput(store.businessName),
  email: store.email.trim().toLowerCase(),
  phone: store.phone.trim(),
  website: store.website.trim(),
  addressLine1: normalizeTextInput(store.addressLine1),
  addressLine2: normalizeTextInput(store.addressLine2),
  city: normalizeTextInput(store.city),
  region: normalizeTextInput(store.region),
  postcode: normalizePostcodeInput(store.postcode),
  country: normalizeTextInput(store.country),
  vatNumber: store.vatNumber.trim(),
  companyNumber: store.companyNumber.trim(),
  defaultCurrency: store.defaultCurrency.trim().toUpperCase(),
  timeZone: store.timeZone.trim(),
  logoUrl: store.logoUrl.trim(),
  footerText: store.footerText.trim(),
  openingHours: normalizeOpeningHours(store.openingHours),
});

const toOpeningHoursFormState = (value: unknown): StoreOpeningHours => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_OPENING_HOURS;
  }

  const record = value as Record<string, unknown>;
  return STORE_WEEKDAYS.reduce((result, weekday) => {
    const rawDay = record[weekday.key];
    if (!rawDay || typeof rawDay !== "object" || Array.isArray(rawDay)) {
      result[weekday.key] = DEFAULT_OPENING_HOURS[weekday.key];
      return result;
    }

    const dayRecord = rawDay as Record<string, unknown>;
    result[weekday.key] = {
      isClosed: typeof dayRecord.isClosed === "boolean" ? dayRecord.isClosed : DEFAULT_OPENING_HOURS[weekday.key].isClosed,
      opensAt: typeof dayRecord.opensAt === "string" ? dayRecord.opensAt : DEFAULT_OPENING_HOURS[weekday.key].opensAt,
      closesAt: typeof dayRecord.closesAt === "string" ? dayRecord.closesAt : DEFAULT_OPENING_HOURS[weekday.key].closesAt,
    };
    return result;
  }, {} as StoreOpeningHours);
};

const toStoreInfoFormState = (store: Record<string, unknown>): StoreInfo => ({
  name: typeof store.name === "string" ? store.name : "",
  businessName: typeof store.businessName === "string" ? store.businessName : "",
  email: typeof store.email === "string" ? store.email : "",
  phone: typeof store.phone === "string" ? store.phone : "",
  website: typeof store.website === "string" ? store.website : "",
  addressLine1: typeof store.addressLine1 === "string" ? store.addressLine1 : "",
  addressLine2: typeof store.addressLine2 === "string" ? store.addressLine2 : "",
  city: typeof store.city === "string" ? store.city : "",
  region: typeof store.region === "string" ? store.region : "",
  postcode: typeof store.postcode === "string" ? store.postcode : "",
  country: typeof store.country === "string" ? store.country : "",
  vatNumber: typeof store.vatNumber === "string" ? store.vatNumber : "",
  companyNumber: typeof store.companyNumber === "string" ? store.companyNumber : "",
  defaultCurrency: typeof store.defaultCurrency === "string" ? store.defaultCurrency : "",
  timeZone: typeof store.timeZone === "string" ? store.timeZone : "",
  logoUrl: typeof store.logoUrl === "string" ? store.logoUrl : "",
  uploadedLogoPath: typeof store.uploadedLogoPath === "string" ? store.uploadedLogoPath : "",
  footerText: typeof store.footerText === "string" ? store.footerText : "",
  openingHours: toOpeningHoursFormState(store.openingHours),
});

const toWorkshopCommercialSettings = (value: unknown): WorkshopCommercialSettings => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_WORKSHOP_COMMERCIAL_SETTINGS;
  }

  const record = value as Record<string, unknown>;
  return {
    commercialSuggestionsEnabled:
      typeof record.commercialSuggestionsEnabled === "boolean"
        ? record.commercialSuggestionsEnabled
        : DEFAULT_WORKSHOP_COMMERCIAL_SETTINGS.commercialSuggestionsEnabled,
    commercialLongGapDays:
      typeof record.commercialLongGapDays === "number" && Number.isInteger(record.commercialLongGapDays)
        ? record.commercialLongGapDays
        : DEFAULT_WORKSHOP_COMMERCIAL_SETTINGS.commercialLongGapDays,
    commercialRecentServiceCooldownDays:
      typeof record.commercialRecentServiceCooldownDays === "number"
        && Number.isInteger(record.commercialRecentServiceCooldownDays)
        ? record.commercialRecentServiceCooldownDays
        : DEFAULT_WORKSHOP_COMMERCIAL_SETTINGS.commercialRecentServiceCooldownDays,
  };
};

const toPrinterFormState = (
  printer: RegisteredPrinter | null,
  defaultShippingLabelPrinterId: string | null,
): PrinterFormState => {
  if (!printer) {
    return DEFAULT_PRINTER_FORM;
  }

  return {
    name: printer.name,
    key: printer.key,
    printerFamily: printer.printerFamily,
    printerModelHint: printer.printerModelHint,
    supportsShippingLabels: printer.supportsShippingLabels,
    isActive: printer.isActive,
    transportMode: printer.transportMode,
    rawTcpHost: printer.rawTcpHost ?? "",
    rawTcpPort: printer.rawTcpPort ? String(printer.rawTcpPort) : "9100",
    location: printer.location ?? "",
    notes: printer.notes ?? "",
    setAsDefaultShippingLabel: printer.id === defaultShippingLabelPrinterId,
  };
};

export const SystemSettingsPage = () => {
  const { error, success } = useToasts();
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [initialStore, setInitialStore] = useState<StoreInfo | null>(null);
  const [selectedLogoFile, setSelectedLogoFile] = useState<File | null>(null);
  const [workshopCommercial, setWorkshopCommercial] = useState<WorkshopCommercialSettings | null>(null);
  const [initialWorkshopCommercial, setInitialWorkshopCommercial] = useState<WorkshopCommercialSettings | null>(null);
  const [printersPayload, setPrintersPayload] = useState<RegisteredPrinterListResponse | null>(null);
  const [selectedPrinterId, setSelectedPrinterId] = useState("");
  const [printerForm, setPrinterForm] = useState<PrinterFormState>(DEFAULT_PRINTER_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [savingWorkshopCommercial, setSavingWorkshopCommercial] = useState(false);
  const [savingPrinter, setSavingPrinter] = useState(false);
  const [settingDefaultPrinter, setSettingDefaultPrinter] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [storePayload, settingsPayload, printersResponse] = await Promise.all([
          apiGet<StoreInfoResponse>("/api/settings/store-info"),
          apiGet<SettingsResponse>("/api/settings"),
          apiGet<RegisteredPrinterListResponse>("/api/settings/printers"),
        ]);
        if (cancelled) {
          return;
        }
        const normalizedStore = toStoreInfoFormState(
          storePayload.store as unknown as Record<string, unknown>,
        );
        const normalizedWorkshopCommercial = toWorkshopCommercialSettings(
          settingsPayload.settings?.workshop as unknown as Record<string, unknown>,
        );
        setStore(normalizedStore);
        setInitialStore(normalizedStore);
        setWorkshopCommercial(normalizedWorkshopCommercial);
        setInitialWorkshopCommercial(normalizedWorkshopCommercial);
        setPrintersPayload(printersResponse);
        const preferredPrinterId =
          printersResponse.defaultShippingLabelPrinterId
          ?? printersResponse.printers[0]?.id
          ?? "";
        setSelectedPrinterId(preferredPrinterId);
        setPrinterForm(
          toPrinterFormState(
            printersResponse.printers.find((printer) => printer.id === preferredPrinterId) ?? null,
            printersResponse.defaultShippingLabelPrinterId,
          ),
        );
      } catch (loadError) {
        if (!cancelled) {
          error(loadError instanceof Error ? loadError.message : "Failed to load settings");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [error]);

  const validationErrors = useMemo(() => {
    if (!store) {
      return {
        fields: {},
        openingHours: {},
      };
    }

    const errors: Partial<Record<keyof StoreInfo, string>> = {};
    const openingHoursErrors: Partial<Record<StoreWeekdayKey, string>> = {};

    if (!store.name.trim()) {
      errors.name = "Store name is required.";
    }
    if (!store.businessName.trim()) {
      errors.businessName = "Business / trading name is required.";
    }
    if (store.email.trim() && !emailRegex.test(store.email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (store.website.trim() && !isValidUrl(store.website)) {
      errors.website = "Website must start with http:// or https://";
    }
    if (!store.addressLine1.trim()) {
      errors.addressLine1 = "Address line 1 is required.";
    }
    if (!store.city.trim()) {
      errors.city = "City / town is required.";
    }
    if (!store.postcode.trim()) {
      errors.postcode = "Postcode is required.";
    }
    if (!store.country.trim()) {
      errors.country = "Country is required.";
    }
    if (!/^[A-Z]{3}$/i.test(store.defaultCurrency.trim())) {
      errors.defaultCurrency = "Use a 3-letter currency code such as GBP.";
    }
    if (!store.timeZone.trim()) {
      errors.timeZone = "Time zone is required.";
    }
    if (store.logoUrl.trim() && !isValidUrl(store.logoUrl)) {
      errors.logoUrl = "Logo URL must start with http:// or https://";
    }

    for (const weekday of STORE_WEEKDAYS) {
      const day = store.openingHours[weekday.key];
      if (day.isClosed) {
        continue;
      }
      if (!day.opensAt || !day.closesAt) {
        openingHoursErrors[weekday.key] = "Opening and closing times are required.";
        continue;
      }
      if (day.opensAt >= day.closesAt) {
        openingHoursErrors[weekday.key] = "Opening time must be earlier than closing time.";
      }
    }

    return {
      fields: errors,
      openingHours: openingHoursErrors,
    };
  }, [store]);

  const isDirty = useMemo(() => {
    if (!store || !initialStore) {
      return false;
    }

    return JSON.stringify(store) !== JSON.stringify(initialStore);
  }, [initialStore, store]);

  const hasValidationErrors = Object.keys(validationErrors.fields).length > 0
    || Object.keys(validationErrors.openingHours).length > 0;
  const preferredLogoUrl = store
    ? (store.uploadedLogoPath || (isValidUrl(store.logoUrl) ? store.logoUrl.trim() : ""))
    : "";
  const isUsingUploadedLogo = Boolean(store?.uploadedLogoPath);

  const workshopCommercialValidationErrors = useMemo(() => {
    if (!workshopCommercial) {
      return {};
    }

    const errors: Partial<Record<keyof WorkshopCommercialSettings, string>> = {};

    if (
      !Number.isInteger(workshopCommercial.commercialLongGapDays)
      || workshopCommercial.commercialLongGapDays < 30
      || workshopCommercial.commercialLongGapDays > 1095
    ) {
      errors.commercialLongGapDays = "Use a whole number of days between 30 and 1095.";
    }

    if (
      !Number.isInteger(workshopCommercial.commercialRecentServiceCooldownDays)
      || workshopCommercial.commercialRecentServiceCooldownDays < 0
      || workshopCommercial.commercialRecentServiceCooldownDays > 365
    ) {
      errors.commercialRecentServiceCooldownDays = "Use a whole number of days between 0 and 365.";
    }

    if (
      Number.isInteger(workshopCommercial.commercialLongGapDays)
      && Number.isInteger(workshopCommercial.commercialRecentServiceCooldownDays)
      && workshopCommercial.commercialLongGapDays < workshopCommercial.commercialRecentServiceCooldownDays
    ) {
      errors.commercialLongGapDays = "Long-gap timing should be equal to or greater than the recent-service cooldown.";
    }

    return errors;
  }, [workshopCommercial]);

  const workshopCommercialDirty = useMemo(() => {
    if (!workshopCommercial || !initialWorkshopCommercial) {
      return false;
    }

    return JSON.stringify(workshopCommercial) !== JSON.stringify(initialWorkshopCommercial);
  }, [initialWorkshopCommercial, workshopCommercial]);

  const hasWorkshopCommercialValidationErrors = Object.keys(workshopCommercialValidationErrors).length > 0;
  const selectedPrinter = useMemo(
    () => printersPayload?.printers.find((printer) => printer.id === selectedPrinterId) ?? null,
    [printersPayload?.printers, selectedPrinterId],
  );
  const printerValidationErrors = useMemo(() => {
    const errors: Partial<Record<keyof PrinterFormState, string>> = {};

    if (!printerForm.name.trim()) {
      errors.name = "Printer name is required.";
    }
    if (!printerForm.key.trim()) {
      errors.key = "Printer key is required.";
    } else if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(printerForm.key.trim())) {
      errors.key = "Use letters, numbers, underscores, or hyphens.";
    }
    if (printerForm.transportMode === "RAW_TCP") {
      if (!printerForm.rawTcpHost.trim()) {
        errors.rawTcpHost = "RAW_TCP printers need a host.";
      }
      const parsedPort = Number.parseInt(printerForm.rawTcpPort, 10);
      if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
        errors.rawTcpPort = "Use a port between 1 and 65535.";
      }
    }

    return errors;
  }, [printerForm]);
  const hasPrinterValidationErrors = Object.keys(printerValidationErrors).length > 0;

  const setField = <K extends keyof StoreInfo>(key: K, value: StoreInfo[K]) => {
    setStore((current) => (current ? { ...current, [key]: value } : current));
  };

  const setPrinterField = <K extends keyof PrinterFormState>(key: K, value: PrinterFormState[K]) => {
    setPrinterForm((current) => ({ ...current, [key]: value }));
  };

  const setWorkshopCommercialField = <K extends keyof WorkshopCommercialSettings>(
    key: K,
    value: WorkshopCommercialSettings[K],
  ) => {
    setWorkshopCommercial((current) => (current ? { ...current, [key]: value } : current));
  };

  const setOpeningHours = (weekday: StoreWeekdayKey, patch: Partial<StoreDailyOpeningHours>) => {
    setStore((current) => {
      if (!current) {
        return current;
      }

      const currentDay = current.openingHours[weekday];
      const nextDay = {
        ...currentDay,
        ...patch,
      };

      return {
        ...current,
        openingHours: {
          ...current.openingHours,
          [weekday]: nextDay.isClosed
            ? { isClosed: true, opensAt: "", closesAt: "" }
            : {
              isClosed: false,
              opensAt: nextDay.opensAt || DEFAULT_OPENING_HOURS[weekday].opensAt,
              closesAt: nextDay.closesAt || DEFAULT_OPENING_HOURS[weekday].closesAt,
            },
        },
      };
    });
  };

  const loadPrinters = async (preferredPrinterId?: string) => {
    const payload = await apiGet<RegisteredPrinterListResponse>("/api/settings/printers");
    setPrintersPayload(payload);
    const nextPrinterId =
      preferredPrinterId
      ?? payload.defaultShippingLabelPrinterId
      ?? payload.printers[0]?.id
      ?? "";
    setSelectedPrinterId(nextPrinterId);
    setPrinterForm(
      toPrinterFormState(
        payload.printers.find((printer) => printer.id === nextPrinterId) ?? null,
        payload.defaultShippingLabelPrinterId,
      ),
    );
    return payload;
  };

  const selectPrinterForEditing = (printerId: string) => {
    const printer = printersPayload?.printers.find((candidate) => candidate.id === printerId) ?? null;
    setSelectedPrinterId(printerId);
    setPrinterForm(toPrinterFormState(printer, printersPayload?.defaultShippingLabelPrinterId ?? null));
  };

  const resetPrinterForm = () => {
    setSelectedPrinterId("");
    setPrinterForm({
      ...DEFAULT_PRINTER_FORM,
      setAsDefaultShippingLabel: printersPayload?.defaultShippingLabelPrinterId === null,
    });
  };

  const handleLogoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedLogoFile(file);
  };

  const saveStoreInfo = async () => {
    if (!store) {
      return;
    }
    if (hasValidationErrors) {
      error("Fix the highlighted Store Info fields before saving.");
      return;
    }

    const normalized = normalizeFormBeforeSave(store);
    setSaving(true);
    try {
      const payload = await apiPatch<StoreInfoResponse>("/api/settings/store-info", normalized);
      const normalizedStore = toStoreInfoFormState(payload.store as unknown as Record<string, unknown>);
      invalidateAppConfigCache();
      setStore(normalizedStore);
      setInitialStore(normalizedStore);
      success("Store Info updated.");
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to update Store Info");
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async () => {
    if (!selectedLogoFile || uploadingLogo || removingLogo) {
      return;
    }

    setUploadingLogo(true);
    try {
      const fileDataUrl = await readFileAsDataUrl(selectedLogoFile);
      const payload = await apiPost<StoreInfoResponse>("/api/settings/store-info/logo", {
        fileDataUrl,
      });
      const nextUploadedLogoPath =
        typeof payload.store.uploadedLogoPath === "string" ? payload.store.uploadedLogoPath : "";
      setStore((current) => (current ? { ...current, uploadedLogoPath: nextUploadedLogoPath } : current));
      setInitialStore((current) => (current ? { ...current, uploadedLogoPath: nextUploadedLogoPath } : current));
      invalidateAppConfigCache();
      setSelectedLogoFile(null);
      success(nextUploadedLogoPath ? "Store logo uploaded." : "Store logo updated.");
    } catch (uploadError) {
      error(uploadError instanceof Error ? uploadError.message : "Failed to upload store logo");
    } finally {
      setUploadingLogo(false);
    }
  };

  const removeUploadedLogo = async () => {
    if (!store?.uploadedLogoPath || removingLogo || uploadingLogo) {
      return;
    }

    setRemovingLogo(true);
    try {
      await apiDelete<StoreInfoResponse>("/api/settings/store-info/logo");
      setStore((current) => (current ? { ...current, uploadedLogoPath: "" } : current));
      setInitialStore((current) => (current ? { ...current, uploadedLogoPath: "" } : current));
      invalidateAppConfigCache();
      setSelectedLogoFile(null);
      success("Uploaded store logo removed.");
    } catch (removeError) {
      error(removeError instanceof Error ? removeError.message : "Failed to remove store logo");
    } finally {
      setRemovingLogo(false);
    }
  };

  const saveWorkshopCommercialSettings = async () => {
    if (!workshopCommercial) {
      return;
    }
    if (hasWorkshopCommercialValidationErrors) {
      error("Fix the highlighted workshop commercial settings before saving.");
      return;
    }

    const normalized = {
      commercialSuggestionsEnabled: workshopCommercial.commercialSuggestionsEnabled,
      commercialLongGapDays: Number.parseInt(String(workshopCommercial.commercialLongGapDays), 10),
      commercialRecentServiceCooldownDays: Number.parseInt(
        String(workshopCommercial.commercialRecentServiceCooldownDays),
        10,
      ),
    };

    setSavingWorkshopCommercial(true);
    try {
      const payload = await apiPatch<SettingsResponse>("/api/settings", {
        workshop: normalized,
      });
      const normalizedWorkshopCommercial = toWorkshopCommercialSettings(
        payload.settings.workshop as unknown as Record<string, unknown>,
      );
      setWorkshopCommercial(normalizedWorkshopCommercial);
      setInitialWorkshopCommercial(normalizedWorkshopCommercial);
      success("Workshop commercial settings updated.");
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to update workshop commercial settings");
    } finally {
      setSavingWorkshopCommercial(false);
    }
  };

  const savePrinter = async () => {
    if (hasPrinterValidationErrors) {
      error("Fix the highlighted printer fields before saving.");
      return;
    }

    const payload = {
      name: printerForm.name.trim(),
      key: printerForm.key.trim().toUpperCase(),
      printerFamily: printerForm.printerFamily,
      printerModelHint: printerForm.printerModelHint,
      supportsShippingLabels: printerForm.supportsShippingLabels,
      isActive: printerForm.isActive,
      transportMode: printerForm.transportMode,
      rawTcpHost: printerForm.transportMode === "RAW_TCP" ? printerForm.rawTcpHost.trim() : null,
      rawTcpPort: printerForm.transportMode === "RAW_TCP"
        ? Number.parseInt(printerForm.rawTcpPort, 10)
        : null,
      location: printerForm.location.trim() || null,
      notes: printerForm.notes.trim() || null,
      setAsDefaultShippingLabel: printerForm.setAsDefaultShippingLabel,
    };

    setSavingPrinter(true);
    try {
      const response = selectedPrinterId
        ? await apiPatch<PrinterMutationResponse>(
          `/api/settings/printers/${encodeURIComponent(selectedPrinterId)}`,
          payload,
        )
        : await apiPost<PrinterMutationResponse>("/api/settings/printers", payload);

      await loadPrinters(response.printer.id);
      success(selectedPrinterId ? "Dispatch printer updated." : "Dispatch printer created.");
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save dispatch printer");
    } finally {
      setSavingPrinter(false);
    }
  };

  const updateDefaultShippingLabelPrinter = async (printerId: string | null) => {
    setSettingDefaultPrinter(true);
    try {
      const response = await apiPut<DefaultShippingLabelPrinterResponse>(
        "/api/settings/printers/default-shipping-label",
        { printerId },
      );
      setPrintersPayload((current) => current
        ? {
          ...current,
          defaultShippingLabelPrinterId: response.defaultShippingLabelPrinterId,
          defaultShippingLabelPrinter: response.defaultShippingLabelPrinter,
          printers: current.printers.map((printer) => ({
            ...printer,
            isDefaultShippingLabelPrinter: printer.id === response.defaultShippingLabelPrinterId,
          })),
        }
        : current);
      setPrinterForm((current) => ({ ...current, setAsDefaultShippingLabel: selectedPrinterId === printerId }));
      success(
        printerId
          ? "Default shipping-label printer updated."
          : "Default shipping-label printer cleared.",
      );
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to update default printer");
    } finally {
      setSettingDefaultPrinter(false);
    }
  };

  return (
    <div className="page-shell ui-page">
      <SurfaceCard className="store-info-hero" tone="soft">
        <PageHeader
          eyebrow="Settings / Store Info"
          title="Store Info"
          description="Central business identity settings for receipts, customer communications, printed documents, and future storefront and profile surfaces."
          actions={(
            <div className="actions-inline">
              <Link to="/settings/receipts">Receipts</Link>
              <Link to="/settings/integrations">Integrations</Link>
            </div>
          )}
        />

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Business Identity</span>
            <strong className="metric-value">{store?.name || "-"}</strong>
            <span className="dashboard-metric-detail">Primary customer-facing store label</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Currency / Time Zone</span>
            <strong className="metric-value">
              {store ? `${store.defaultCurrency} · ${store.timeZone}` : "-"}
            </strong>
            <span className="dashboard-metric-detail">Used by future configuration-driven workflows</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Receipt Footer</span>
            <strong className="metric-value">{store?.footerText ? "Configured" : "Default"}</strong>
            <span className="dashboard-metric-detail">Synced into current receipt metadata compatibility settings</span>
          </div>
        </div>

        <div className="restricted-panel info-panel">
          Store Info is the app-level source of truth for the shop&apos;s identity, opening hours, and other shared operational settings. Receipt settings stay compatible automatically, and weather plus rota features use the saved store schedule data.
        </div>
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader
          title="Business Details"
          description="Define how the shop should identify itself across customer-facing and operational surfaces."
          actions={(
            <button
              type="button"
              className="primary"
              onClick={() => void saveStoreInfo()}
              disabled={!store || !isDirty || hasValidationErrors || saving}
            >
              {saving ? "Saving..." : "Save Store Info"}
            </button>
          )}
        />

        {loading ? (
          <EmptyState title="Loading Store Info" description="Fetching the current store profile, contact details, and opening hours." />
        ) : null}

        {!loading && store ? (
          <div className="store-info-sections">
            <section className="store-info-section">
              <h3>Business Details</h3>
              <div className="purchase-form-grid store-info-grid">
                <label>
                  Store name
                  <input
                    value={store.name}
                    onChange={(event) => setField("name", event.target.value)}
                    placeholder="CorePOS Cycles"
                  />
                  {validationErrors.fields.name ? <span className="field-error">{validationErrors.fields.name}</span> : null}
                </label>
                <label>
                  Business / trading name
                  <input
                    value={store.businessName}
                    onChange={(event) => setField("businessName", event.target.value)}
                    placeholder="CorePOS Cycles Ltd"
                  />
                  {validationErrors.fields.businessName ? (
                    <span className="field-error">{validationErrors.fields.businessName}</span>
                  ) : null}
                </label>
                <label>
                  Default currency
                  <input
                    list="store-currencies"
                    value={store.defaultCurrency}
                    onChange={(event) => setField("defaultCurrency", event.target.value)}
                    placeholder="GBP"
                  />
                  {validationErrors.fields.defaultCurrency ? (
                    <span className="field-error">{validationErrors.fields.defaultCurrency}</span>
                  ) : null}
                </label>
                <label>
                  Time zone
                  <input
                    list="store-timezones"
                    value={store.timeZone}
                    onChange={(event) => setField("timeZone", event.target.value)}
                    placeholder="Europe/London"
                  />
                  {validationErrors.fields.timeZone ? (
                    <span className="field-error">{validationErrors.fields.timeZone}</span>
                  ) : null}
                </label>
              </div>
            </section>

            <section className="store-info-section">
              <h3>Contact Details</h3>
              <div className="purchase-form-grid store-info-grid">
                <label>
                  Email address
                  <input
                    value={store.email}
                    onChange={(event) => setField("email", event.target.value)}
                    placeholder="hello@corepos.local"
                  />
                  {validationErrors.fields.email ? <span className="field-error">{validationErrors.fields.email}</span> : null}
                </label>
                <label>
                  Phone number
                  <input
                    value={store.phone}
                    onChange={(event) => setField("phone", event.target.value)}
                    placeholder="01234 567890"
                  />
                </label>
                <label className="store-info-grid-span">
                  Website
                  <input
                    value={store.website}
                    onChange={(event) => setField("website", event.target.value)}
                    placeholder="https://www.corepos.example"
                  />
                  {validationErrors.fields.website ? (
                    <span className="field-error">{validationErrors.fields.website}</span>
                  ) : null}
                </label>
              </div>
            </section>

            <section className="store-info-section">
              <h3>Opening Hours</h3>
              <p className="muted-text">Used as the source of truth for full-day rota imports and dashboard schedule interpretation.</p>
              <div className="store-opening-hours">
                {STORE_WEEKDAYS.map((weekday) => {
                  const day = store.openingHours[weekday.key];
                  return (
                    <div key={weekday.key} className="store-opening-hours-row">
                      <div>
                        <strong>{weekday.label}</strong>
                      </div>
                      <label className="store-opening-hours-toggle">
                        <input
                          type="checkbox"
                          checked={day.isClosed}
                          onChange={(event) => setOpeningHours(weekday.key, { isClosed: event.target.checked })}
                        />
                        Closed
                      </label>
                      <input
                        type="time"
                        value={day.opensAt}
                        disabled={day.isClosed}
                        onChange={(event) => setOpeningHours(weekday.key, { opensAt: event.target.value })}
                      />
                      <span className="muted-text">to</span>
                      <input
                        type="time"
                        value={day.closesAt}
                        disabled={day.isClosed}
                        onChange={(event) => setOpeningHours(weekday.key, { closesAt: event.target.value })}
                      />
                      {validationErrors.openingHours[weekday.key] ? (
                        <span className="field-error store-opening-hours-error">
                          {validationErrors.openingHours[weekday.key]}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="store-info-section">
              <h3>Address</h3>
              <div className="purchase-form-grid store-info-grid">
                <label className="store-info-grid-span">
                  Address line 1
                  <input
                    value={store.addressLine1}
                    onChange={(event) => setField("addressLine1", event.target.value)}
                    placeholder="123 Service Lane"
                  />
                  {validationErrors.fields.addressLine1 ? (
                    <span className="field-error">{validationErrors.fields.addressLine1}</span>
                  ) : null}
                </label>
                <label className="store-info-grid-span">
                  Address line 2
                  <input
                    value={store.addressLine2}
                    onChange={(event) => setField("addressLine2", event.target.value)}
                    placeholder="Industrial Estate / Unit / District"
                  />
                </label>
                <label>
                  City / town
                  <input
                    value={store.city}
                    onChange={(event) => setField("city", event.target.value)}
                    placeholder="Clapham"
                  />
                  {validationErrors.fields.city ? <span className="field-error">{validationErrors.fields.city}</span> : null}
                </label>
                <label>
                  County / region
                  <input
                    value={store.region}
                    onChange={(event) => setField("region", event.target.value)}
                    placeholder="Greater London"
                  />
                </label>
                <label>
                  Postcode
                  <input
                    value={store.postcode}
                    onChange={(event) => setField("postcode", event.target.value)}
                    placeholder="SW4 0HY"
                  />
                  {validationErrors.fields.postcode ? (
                    <span className="field-error">{validationErrors.fields.postcode}</span>
                  ) : null}
                </label>
                <label>
                  Country
                  <input
                    value={store.country}
                    onChange={(event) => setField("country", event.target.value)}
                    placeholder="United Kingdom"
                  />
                  {validationErrors.fields.country ? (
                    <span className="field-error">{validationErrors.fields.country}</span>
                  ) : null}
                </label>
              </div>
            </section>

            <section className="store-info-section">
              <h3>Financial / Legal</h3>
              <div className="purchase-form-grid store-info-grid">
                <label>
                  VAT number
                  <input
                    value={store.vatNumber}
                    onChange={(event) => setField("vatNumber", event.target.value)}
                    placeholder="GB123456789"
                  />
                </label>
                <label>
                  Company number
                  <input
                    value={store.companyNumber}
                    onChange={(event) => setField("companyNumber", event.target.value)}
                    placeholder="01234567"
                  />
                </label>
              </div>
            </section>

            <section className="store-info-section">
              <h3>Branding / Footer</h3>
              <div className="purchase-form-grid store-info-grid">
                <div className="store-logo-panel store-info-grid-span">
                  <div className="store-logo-panel__copy">
                    <strong>Current logo</strong>
                    <span className="muted-text">
                      {isUsingUploadedLogo
                        ? "Uploaded CorePOS-managed logo is active and will be preferred on receipts."
                        : store.logoUrl.trim()
                          ? "No uploaded logo is active, so receipts will fall back to the external logo URL."
                          : "No logo is configured yet."}
                    </span>
                  </div>

                  <div className="store-logo-preview">
                    {preferredLogoUrl ? (
                      <img
                        src={preferredLogoUrl}
                        alt={`${store.name || "Store"} logo preview`}
                      />
                    ) : (
                      <div className="store-logo-preview__empty">No logo configured</div>
                    )}
                  </div>

                  <div className="store-logo-controls">
                    <label>
                      Upload / replace logo
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleLogoFileChange}
                      />
                    </label>

                    <div className="store-logo-buttons">
                      <button
                        type="button"
                        onClick={() => void uploadLogo()}
                        disabled={!selectedLogoFile || uploadingLogo || removingLogo}
                      >
                        {uploadingLogo
                          ? "Uploading..."
                          : isUsingUploadedLogo
                            ? "Replace uploaded logo"
                            : "Upload logo"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeUploadedLogo()}
                        disabled={!store.uploadedLogoPath || removingLogo || uploadingLogo}
                      >
                        {removingLogo ? "Removing..." : "Remove uploaded logo"}
                      </button>
                    </div>
                  </div>

                  <div className="muted-text">
                    {selectedLogoFile
                      ? `Selected file: ${selectedLogoFile.name}`
                      : "PNG, JPG, or WEBP up to 5MB. Uploaded logos are stored locally and preferred on receipts."}
                  </div>
                </div>
                <label className="store-info-grid-span">
                  Logo URL fallback
                  <input
                    value={store.logoUrl}
                    onChange={(event) => setField("logoUrl", event.target.value)}
                    placeholder="https://cdn.example.com/logo.png"
                  />
                  {validationErrors.fields.logoUrl ? (
                    <span className="field-error">{validationErrors.fields.logoUrl}</span>
                  ) : null}
                </label>
                <label className="store-info-grid-span">
                  Receipt / business footer text
                  <textarea
                    rows={4}
                    value={store.footerText}
                    onChange={(event) => setField("footerText", event.target.value)}
                    placeholder="Thank you for your custom."
                  />
                </label>
              </div>
            </section>
          </div>
        ) : null}
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader
          title="Workshop Commercial Suggestions"
          description="Control the explainable workshop prompts that use bike history, care-plan timing, and current workshop context to surface relevant extra work."
          actions={(
            <button
              type="button"
              className="primary"
              onClick={() => void saveWorkshopCommercialSettings()}
              disabled={
                !workshopCommercial
                || !workshopCommercialDirty
                || hasWorkshopCommercialValidationErrors
                || savingWorkshopCommercial
              }
            >
              {savingWorkshopCommercial ? "Saving..." : "Save Commercial Settings"}
            </button>
          )}
        />

        {loading ? (
          <EmptyState
            title="Loading Workshop Commercial Settings"
            description="Fetching the current rules for service prompts and workshop follow-up suggestions."
          />
        ) : null}

        {!loading && workshopCommercial ? (
          <div className="store-info-sections">
            <section className="store-info-section">
              <h3>Suggestion Controls</h3>
              <div className="purchase-form-grid store-info-grid">
                <label className="store-info-grid-span store-settings-checkbox">
                  <span>Enable workshop commercial suggestions</span>
                  <div className="table-secondary">
                    Show explainable staff-facing prompts on intake, job, and bike-history surfaces.
                  </div>
                  <input
                    type="checkbox"
                    checked={workshopCommercial.commercialSuggestionsEnabled}
                    onChange={(event) =>
                      setWorkshopCommercialField("commercialSuggestionsEnabled", event.target.checked)}
                  />
                </label>
                <label>
                  Long-gap service window (days)
                  <input
                    type="number"
                    min={30}
                    max={1095}
                    step={1}
                    value={workshopCommercial.commercialLongGapDays}
                    onChange={(event) =>
                      setWorkshopCommercialField(
                        "commercialLongGapDays",
                        Number.parseInt(event.target.value || "0", 10),
                      )}
                  />
                  {workshopCommercialValidationErrors.commercialLongGapDays ? (
                    <span className="field-error">
                      {workshopCommercialValidationErrors.commercialLongGapDays}
                    </span>
                  ) : null}
                </label>
                <label>
                  Recent-service cooldown (days)
                  <input
                    type="number"
                    min={0}
                    max={365}
                    step={1}
                    value={workshopCommercial.commercialRecentServiceCooldownDays}
                    onChange={(event) =>
                      setWorkshopCommercialField(
                        "commercialRecentServiceCooldownDays",
                        Number.parseInt(event.target.value || "0", 10),
                      )}
                  />
                  {workshopCommercialValidationErrors.commercialRecentServiceCooldownDays ? (
                    <span className="field-error">
                      {workshopCommercialValidationErrors.commercialRecentServiceCooldownDays}
                    </span>
                  ) : null}
                </label>
              </div>
              <div className="restricted-panel info-panel">
                These controls shape a rules-based suggestion layer. Long-gap prompts handle bikes with meaningful time since the last completed service, while the cooldown prevents staff from raising the same type of recommendation immediately after recent work.
              </div>
            </section>
          </div>
        ) : null}
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader
          title="Dispatch Printers"
          description="Register the Zebra-style printers that shipment-label workflows are allowed to target, and choose the default printer used by dispatch."
          actions={(
            <div className="actions-inline">
              <button type="button" className="button-link" onClick={resetPrinterForm}>
                New Printer
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void savePrinter()}
                disabled={savingPrinter || hasPrinterValidationErrors}
              >
                {savingPrinter ? "Saving..." : selectedPrinterId ? "Save Printer" : "Create Printer"}
              </button>
            </div>
          )}
        />

        {loading ? (
          <EmptyState
            title="Loading Dispatch Printers"
            description="Fetching the registered printer list and current default shipping-label target."
          />
        ) : null}

        {!loading ? (
          <div className="dispatch-printers-layout">
            <section className="store-info-section dispatch-printers-list">
              <h3>Registered Printers</h3>
              {printersPayload?.printers.length ? (
                <div className="dispatch-printers-list__items">
                  {printersPayload.printers.map((printer) => {
                    const isSelected = printer.id === selectedPrinterId;
                    return (
                      <button
                        key={printer.id}
                        type="button"
                        className={`dispatch-printer-row${isSelected ? " dispatch-printer-row--selected" : ""}`}
                        onClick={() => selectPrinterForEditing(printer.id)}
                      >
                        <div className="dispatch-printer-row__topline">
                          <strong>{printer.name}</strong>
                          {printer.isDefaultShippingLabelPrinter ? (
                            <span className="status-badge status-ready">Default</span>
                          ) : null}
                        </div>
                        <div className="dispatch-printer-row__meta">
                          <span>{printer.key}</span>
                          <span>{printer.transportMode}</span>
                        </div>
                        <div className="dispatch-printer-row__meta dispatch-printer-row__meta--muted">
                          <span>{printer.supportsShippingLabels ? "Shipping labels enabled" : "Shipping labels disabled"}</span>
                          <span>{printer.isActive ? "Active" : "Inactive"}</span>
                        </div>
                        <div className="dispatch-printer-row__meta dispatch-printer-row__meta--muted">
                          <span>{printer.location || "No location set"}</span>
                          <span>
                            {printer.transportMode === "RAW_TCP"
                              ? `${printer.rawTcpHost ?? "-"}:${printer.rawTcpPort ?? "-"}`
                              : "Dry-run transport"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title="No dispatch printers yet"
                  description="Create the first registered shipping-label printer so web-order dispatch can target a managed Zebra path instead of a free-text name."
                />
              )}
            </section>

            <section className="store-info-section dispatch-printers-editor">
              <h3>{selectedPrinter ? "Edit Printer" : "Create Printer"}</h3>
              <div className="purchase-form-grid store-info-grid">
                <label>
                  Printer name
                  <input
                    value={printerForm.name}
                    onChange={(event) => setPrinterField("name", event.target.value)}
                    placeholder="Dispatch Zebra GK420d"
                  />
                  {printerValidationErrors.name ? <span className="field-error">{printerValidationErrors.name}</span> : null}
                </label>
                <label>
                  Internal key
                  <input
                    value={printerForm.key}
                    onChange={(event) => setPrinterField("key", event.target.value.toUpperCase())}
                    placeholder="DISPATCH_ZEBRA_GK420D"
                  />
                  {printerValidationErrors.key ? <span className="field-error">{printerValidationErrors.key}</span> : null}
                </label>
                <label>
                  Printer family
                  <input value={printerForm.printerFamily} disabled />
                </label>
                <label>
                  Model hint
                  <input value={printerForm.printerModelHint} disabled />
                </label>
                <label>
                  Transport mode
                  <select
                    value={printerForm.transportMode}
                    onChange={(event) =>
                      setPrinterField("transportMode", event.target.value as RegisteredPrinterTransportMode)}
                  >
                    <option value="DRY_RUN">DRY_RUN</option>
                    <option value="RAW_TCP">RAW_TCP</option>
                  </select>
                </label>
                <label>
                  Location / notes label
                  <input
                    value={printerForm.location}
                    onChange={(event) => setPrinterField("location", event.target.value)}
                    placeholder="Dispatch bench"
                  />
                </label>
                <label>
                  RAW_TCP host
                  <input
                    value={printerForm.rawTcpHost}
                    onChange={(event) => setPrinterField("rawTcpHost", event.target.value)}
                    placeholder="192.168.1.45"
                    disabled={printerForm.transportMode !== "RAW_TCP"}
                  />
                  {printerValidationErrors.rawTcpHost ? (
                    <span className="field-error">{printerValidationErrors.rawTcpHost}</span>
                  ) : null}
                </label>
                <label>
                  RAW_TCP port
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    step={1}
                    value={printerForm.rawTcpPort}
                    onChange={(event) => setPrinterField("rawTcpPort", event.target.value)}
                    disabled={printerForm.transportMode !== "RAW_TCP"}
                  />
                  {printerValidationErrors.rawTcpPort ? (
                    <span className="field-error">{printerValidationErrors.rawTcpPort}</span>
                  ) : null}
                </label>
                <label className="store-info-grid-span">
                  Notes
                  <textarea
                    rows={3}
                    value={printerForm.notes}
                    onChange={(event) => setPrinterField("notes", event.target.value)}
                    placeholder="Windows dispatch machine beside packing bench."
                  />
                </label>
                <label className="store-info-grid-span store-settings-checkbox">
                  <span>Supports shipping labels</span>
                  <div className="table-secondary">
                    Only printers with shipping-label capability can be selected in the web-order dispatch flow.
                  </div>
                  <input
                    type="checkbox"
                    checked={printerForm.supportsShippingLabels}
                    onChange={(event) => setPrinterField("supportsShippingLabels", event.target.checked)}
                  />
                </label>
                <label className="store-info-grid-span store-settings-checkbox">
                  <span>Printer is active</span>
                  <div className="table-secondary">
                    Inactive printers stay on record for audit/history but cannot be used for shipment printing.
                  </div>
                  <input
                    type="checkbox"
                    checked={printerForm.isActive}
                    onChange={(event) => setPrinterField("isActive", event.target.checked)}
                  />
                </label>
                <label className="store-info-grid-span store-settings-checkbox">
                  <span>Make this the default shipping-label printer</span>
                  <div className="table-secondary">
                    Dispatch uses this printer automatically when staff do not choose another registered target.
                  </div>
                  <input
                    type="checkbox"
                    checked={printerForm.setAsDefaultShippingLabel}
                    onChange={(event) =>
                      setPrinterField("setAsDefaultShippingLabel", event.target.checked)}
                  />
                </label>
              </div>

              {selectedPrinter ? (
                <div className="dispatch-printer-editor__actions">
                  <button
                    type="button"
                    onClick={() => void updateDefaultShippingLabelPrinter(selectedPrinter.id)}
                    disabled={settingDefaultPrinter || !selectedPrinter.isActive || !selectedPrinter.supportsShippingLabels}
                  >
                    {settingDefaultPrinter ? "Updating..." : "Set As Default Printer"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateDefaultShippingLabelPrinter(null)}
                    disabled={settingDefaultPrinter || printersPayload?.defaultShippingLabelPrinterId !== selectedPrinter.id}
                  >
                    Clear Default
                  </button>
                </div>
              ) : null}

              <div className="restricted-panel info-panel">
                Registered printers give the shipment workflow a stable target. CorePOS now resolves shipment-label printing through these records instead of relying on a free-text printer hint from the dispatch UI.
              </div>
            </section>
          </div>
        ) : null}
      </SurfaceCard>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Future Reuse</h2>
            <p className="muted-text">This page is intended to support more than just admin editing.</p>
          </div>
        </div>
        <div className="store-info-support">
          <div className="metric-card">
            <span className="metric-label">Receipts & Printed Docs</span>
            <span className="dashboard-metric-detail">Name, address, VAT number, and footer are kept compatible with current receipt generation.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Customer Communications</span>
            <span className="dashboard-metric-detail">Email, phone, website, and store name are ready for reminders, updates, and later outbound templates.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Operational Scheduling</span>
            <span className="dashboard-metric-detail">Opening hours now feed rota imports and dashboard staffing interpretation from the same Store Info source.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Website / Storefront</span>
            <span className="dashboard-metric-detail">Logo, footer, address, and business identity fields can feed the future public-facing profile and site surfaces.</span>
          </div>
        </div>
      </section>

      <datalist id="store-timezones">
        {COMMON_TIME_ZONES.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <datalist id="store-currencies">
        {COMMON_CURRENCIES.map((currency) => (
          <option key={currency} value={currency} />
        ))}
      </datalist>
    </div>
  );
};
