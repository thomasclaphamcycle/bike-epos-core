import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

type HireAssetStatus = "AVAILABLE" | "RESERVED" | "ON_HIRE" | "MAINTENANCE" | "RETIRED";
type HireBookingStatus = "RESERVED" | "CHECKED_OUT" | "RETURNED" | "CANCELLED";
type HireDepositStatus = "NONE" | "HELD" | "RETURNED" | "KEPT";
type RentalView = "calendar" | "new" | "active" | "returns" | "history";

type VariantSearchRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string | null;
  option: string | null;
  retailPricePence: number;
  product: {
    id: string;
    name: string;
    brand: string | null;
  };
};

type VariantListResponse = {
  variants: VariantSearchRow[];
};

type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

type CustomerSearchResponse = {
  customers: CustomerRow[];
};

type HireAsset = {
  id: string;
  assetTag: string;
  displayName: string | null;
  notes: string | null;
  storageLocation: string | null;
  isOnlineBookable: boolean;
  storedStatus: HireAssetStatus;
  status: HireAssetStatus;
  createdAt: string;
  updatedAt: string;
  variant: {
    id: string;
    sku: string;
    barcode: string | null;
    variantName: string | null;
    retailPricePence: number;
    productId: string;
    productName: string;
    brand: string | null;
  };
  activeBooking: HireAssetBookingSummary | null;
  currentBooking: HireAssetBookingSummary | null;
  nextBooking: HireAssetBookingSummary | null;
  upcomingBookings: HireAssetBookingSummary[];
  availability: {
    availableNow: boolean;
    nextAvailableAt: string | null;
    nextPickupAt: string | null;
    requestedWindow: {
      startsAt: string;
      dueBackAt: string;
      isAvailable: boolean;
      blockedByBookingId: string | null;
    } | null;
    activeBookingCount: number;
    checkedOutCount: number;
    reservedCount: number;
  };
};

type HireAssetBookingSummary = {
  id: string;
  status: HireBookingStatus;
  startsAt: string;
  dueBackAt: string;
  customer: {
    id: string;
    name: string;
  };
};

type HireAssetListResponse = {
  summary: {
    total: number;
    available: number;
    reserved: number;
    onHire: number;
    maintenance: number;
    retired: number;
    onlineBookable: number;
    availableNow: number;
  };
  assets: HireAsset[];
};

type HireBooking = {
  id: string;
  status: HireBookingStatus;
  depositStatus: HireDepositStatus;
  startsAt: string;
  dueBackAt: string;
  checkedOutAt: string | null;
  returnedAt: string | null;
  cancelledAt: string | null;
  hirePricePence: number;
  depositPence: number;
  depositHeldPence: number;
  notes: string | null;
  pickupNotes: string | null;
  returnNotes: string | null;
  cancellationReason: string | null;
  damageNotes: string | null;
  createdAt: string;
  updatedAt: string;
  operational: {
    state: "UPCOMING_PICKUP" | "ACTIVE" | "DUE_BACK_TODAY" | "OVERDUE" | "COMPLETED" | "CANCELLED";
    label: string;
    detail: string;
    pickupToday: boolean;
    pickupTomorrow: boolean;
    dueToday: boolean;
    dueTomorrow: boolean;
    overdue: boolean;
    canCheckout: boolean;
    canReturn: boolean;
    canCancel: boolean;
  };
  financial: {
    hirePricePence: number;
    depositPence: number;
    depositHeldPence: number;
    outstandingDepositPence: number;
  };
  hireAsset: {
    id: string;
    assetTag: string;
    displayName: string | null;
    notes: string | null;
    storageLocation: string | null;
    isOnlineBookable: boolean;
    storedStatus: HireAssetStatus;
    status: HireAssetStatus;
    variant: {
      id: string;
      sku: string;
      barcode: string | null;
      variantName: string | null;
      retailPricePence: number;
      productId: string;
      productName: string;
      brand: string | null;
    };
  };
  customer: CustomerRow;
};

type HireBookingListResponse = {
  summary: {
    total: number;
    reserved: number;
    checkedOut: number;
    returned: number;
    cancelled: number;
    overdue: number;
    pickupsToday: number;
    returnsToday: number;
  };
  bookings: HireBooking[];
};

type AssetEditorState = {
  displayName: string;
  notes: string;
  storageLocation: string;
  isOnlineBookable: boolean;
  status: "AVAILABLE" | "MAINTENANCE" | "RETIRED";
};

const RENTAL_NAV: Array<{ view: RentalView; label: string; to: string }> = [
  { view: "calendar", label: "Rental Calendar", to: "/rental/calendar" },
  { view: "new", label: "New Rental", to: "/rental/new" },
  { view: "active", label: "Active Rentals", to: "/rental/active" },
  { view: "returns", label: "Returns", to: "/rental/returns" },
  { view: "history", label: "Rental History", to: "/rental/history" },
];

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatStatus = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "-";

const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "-";

const formatTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "-";

const toLocalDateTimeInput = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  const hours = `${value.getHours()}`.padStart(2, "0");
  const minutes = `${value.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const toIsoFromLocalInput = (value: string) => new Date(value).toISOString();

const getRentalView = (pathname: string): RentalView => {
  if (pathname.endsWith("/new")) {
    return "new";
  }
  if (pathname.endsWith("/active")) {
    return "active";
  }
  if (pathname.endsWith("/returns")) {
    return "returns";
  }
  if (pathname.endsWith("/history")) {
    return "history";
  }
  return "calendar";
};

const getStatusBadgeClass = (value: string) => {
  if (value === "OVERDUE" || value === "RETIRED") {
    return "status-badge status-warning";
  }
  if (value === "DUE_BACK_TODAY" || value === "RESERVED" || value === "MAINTENANCE") {
    return "status-badge";
  }
  if (value === "CHECKED_OUT" || value === "ON_HIRE") {
    return "status-badge status-warning";
  }
  if (value === "RETURNED" || value === "AVAILABLE" || value === "COMPLETED") {
    return "status-badge status-ready";
  }
  return "status-badge";
};

const toAssetEditorState = (asset: HireAsset): AssetEditorState => ({
  displayName: asset.displayName ?? "",
  notes: asset.notes ?? "",
  storageLocation: asset.storageLocation ?? "",
  isOnlineBookable: asset.isOnlineBookable,
  status:
    asset.storedStatus === "MAINTENANCE" || asset.storedStatus === "RETIRED"
      ? asset.storedStatus
      : "AVAILABLE",
});

const sortByDateAsc = <T,>(items: T[], accessor: (item: T) => string) =>
  [...items].sort(
    (left, right) => new Date(accessor(left)).getTime() - new Date(accessor(right)).getTime(),
  );

export const BikeHirePage = () => {
  const location = useLocation();
  const rentalView = useMemo(() => getRentalView(location.pathname), [location.pathname]);
  const { error, success } = useToasts();

  const [assets, setAssets] = useState<HireAsset[]>([]);
  const [bookings, setBookings] = useState<HireBooking[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingAsset, setCreatingAsset] = useState(false);
  const [savingAssetId, setSavingAssetId] = useState<string | null>(null);
  const [creatingBooking, setCreatingBooking] = useState(false);
  const [workingBookingId, setWorkingBookingId] = useState<string | null>(null);

  const [variantQuery, setVariantQuery] = useState("");
  const [variantMatches, setVariantMatches] = useState<VariantSearchRow[]>([]);
  const [variantSearchLoading, setVariantSearchLoading] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const debouncedVariantQuery = useDebouncedValue(variantQuery, 200);

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerMatches, setCustomerMatches] = useState<CustomerRow[]>([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const debouncedCustomerQuery = useDebouncedValue(customerQuery, 200);

  const [assetTag, setAssetTag] = useState("");
  const [assetDisplayName, setAssetDisplayName] = useState("");
  const [assetNotes, setAssetNotes] = useState("");
  const [assetStorageLocation, setAssetStorageLocation] = useState("");
  const [assetOnlineBookable, setAssetOnlineBookable] = useState(false);

  const [bookingAssetId, setBookingAssetId] = useState("");
  const [bookingStartsAt, setBookingStartsAt] = useState(() => toLocalDateTimeInput(new Date()));
  const [bookingDueBackAt, setBookingDueBackAt] = useState(() => {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(10, 0, 0, 0);
    return toLocalDateTimeInput(next);
  });
  const [bookingHirePricePence, setBookingHirePricePence] = useState("4500");
  const [bookingDepositPence, setBookingDepositPence] = useState("15000");
  const [bookingNotes, setBookingNotes] = useState("");

  const [windowAssets, setWindowAssets] = useState<HireAsset[]>([]);
  const [windowAssetsLoading, setWindowAssetsLoading] = useState(false);

  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [assetEditor, setAssetEditor] = useState<AssetEditorState | null>(null);

  const [checkoutDepositByBooking, setCheckoutDepositByBooking] = useState<Record<string, string>>({});
  const [pickupNotesByBooking, setPickupNotesByBooking] = useState<Record<string, string>>({});
  const [returnOutcomeByBooking, setReturnOutcomeByBooking] = useState<Record<string, "RETURNED" | "KEPT">>({});
  const [returnNotesByBooking, setReturnNotesByBooking] = useState<Record<string, string>>({});
  const [damageNotesByBooking, setDamageNotesByBooking] = useState<Record<string, string>>({});
  const [markMaintenanceByBooking, setMarkMaintenanceByBooking] = useState<Record<string, boolean>>({});
  const [cancelReasonByBooking, setCancelReasonByBooking] = useState<Record<string, string>>({});

  const loadHireData = async () => {
    setLoading(true);

    const [assetResult, bookingResult] = await Promise.allSettled([
      apiGet<HireAssetListResponse>("/api/hire/assets?take=200"),
      apiGet<HireBookingListResponse>("/api/hire/bookings?take=200"),
    ]);

    if (assetResult.status === "fulfilled") {
      setAssets(assetResult.value.assets ?? []);
    } else {
      setAssets([]);
      error(assetResult.reason instanceof Error ? assetResult.reason.message : "Failed to load hire fleet");
    }

    if (bookingResult.status === "fulfilled") {
      setBookings(bookingResult.value.bookings ?? []);
    } else {
      setBookings([]);
      error(bookingResult.reason instanceof Error ? bookingResult.reason.message : "Failed to load hire bookings");
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadHireData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!debouncedVariantQuery.trim() || debouncedVariantQuery.trim().length < 2) {
      setVariantMatches([]);
      return;
    }

    let cancelled = false;

    const loadMatches = async () => {
      setVariantSearchLoading(true);
      try {
        const payload = await apiGet<VariantListResponse>(
          `/api/variants?q=${encodeURIComponent(debouncedVariantQuery.trim())}&active=1&take=20&skip=0`,
        );
        if (cancelled) {
          return;
        }

        const nextMatches = payload.variants ?? [];
        setVariantMatches(nextMatches);
        setSelectedVariantId((current) =>
          current && nextMatches.some((variant) => variant.id === current)
            ? current
            : nextMatches[0]?.id ?? "",
        );
      } catch (loadError) {
        if (!cancelled) {
          error(loadError instanceof Error ? loadError.message : "Failed to search variants");
        }
      } finally {
        if (!cancelled) {
          setVariantSearchLoading(false);
        }
      }
    };

    void loadMatches();

    return () => {
      cancelled = true;
    };
  }, [debouncedVariantQuery, error]);

  useEffect(() => {
    if (!debouncedCustomerQuery.trim() || debouncedCustomerQuery.trim().length < 2) {
      setCustomerMatches([]);
      return;
    }

    let cancelled = false;

    const loadMatches = async () => {
      setCustomerSearchLoading(true);
      try {
        const payload = await apiGet<CustomerSearchResponse>(
          `/api/customers/search?q=${encodeURIComponent(debouncedCustomerQuery.trim())}&take=12`,
        );
        if (cancelled) {
          return;
        }

        const nextMatches = payload.customers ?? [];
        setCustomerMatches(nextMatches);
        setSelectedCustomerId((current) =>
          current && nextMatches.some((customer) => customer.id === current)
            ? current
            : nextMatches[0]?.id ?? "",
        );
      } catch (loadError) {
        if (!cancelled) {
          error(loadError instanceof Error ? loadError.message : "Failed to search customers");
        }
      } finally {
        if (!cancelled) {
          setCustomerSearchLoading(false);
        }
      }
    };

    void loadMatches();

    return () => {
      cancelled = true;
    };
  }, [debouncedCustomerQuery, error]);

  useEffect(() => {
    const startsAt = new Date(bookingStartsAt);
    const dueBackAt = new Date(bookingDueBackAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(dueBackAt.getTime()) || startsAt >= dueBackAt) {
      setWindowAssets([]);
      return;
    }

    let cancelled = false;

    const loadWindowAssets = async () => {
      setWindowAssetsLoading(true);
      try {
        const payload = await apiGet<HireAssetListResponse>(
          `/api/hire/assets?availableFrom=${encodeURIComponent(startsAt.toISOString())}&availableTo=${encodeURIComponent(
            dueBackAt.toISOString(),
          )}&take=200`,
        );
        if (!cancelled) {
          setWindowAssets(payload.assets ?? []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setWindowAssets([]);
          error(loadError instanceof Error ? loadError.message : "Failed to load available hire bikes");
        }
      } finally {
        if (!cancelled) {
          setWindowAssetsLoading(false);
        }
      }
    };

    void loadWindowAssets();

    return () => {
      cancelled = true;
    };
  }, [bookingStartsAt, bookingDueBackAt, error]);

  useEffect(() => {
    if (bookingAssetId && windowAssets.some((asset) => asset.id === bookingAssetId)) {
      return;
    }
    setBookingAssetId(windowAssets[0]?.id ?? "");
  }, [windowAssets, bookingAssetId]);

  const selectedVariant = variantMatches.find((variant) => variant.id === selectedVariantId) ?? null;
  const selectedCustomer = customerMatches.find((customer) => customer.id === selectedCustomerId) ?? null;

  const reservedBookings = useMemo(
    () => sortByDateAsc(bookings.filter((booking) => booking.status === "RESERVED"), (booking) => booking.startsAt),
    [bookings],
  );
  const checkedOutBookings = useMemo(
    () => sortByDateAsc(
      bookings.filter((booking) => booking.status === "CHECKED_OUT"),
      (booking) => booking.dueBackAt,
    ),
    [bookings],
  );
  const overdueBookings = useMemo(
    () => checkedOutBookings.filter((booking) => booking.operational.overdue),
    [checkedOutBookings],
  );
  const returnsToday = useMemo(
    () => checkedOutBookings.filter((booking) => booking.operational.dueToday),
    [checkedOutBookings],
  );
  const pickupsToday = useMemo(
    () => reservedBookings.filter((booking) => booking.operational.pickupToday),
    [reservedBookings],
  );
  const historyBookings = useMemo(
    () =>
      [...bookings]
        .filter((booking) => booking.status === "RETURNED" || booking.status === "CANCELLED")
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
    [bookings],
  );
  const maintenanceAssets = useMemo(
    () => assets.filter((asset) => asset.status === "MAINTENANCE" || asset.status === "RETIRED"),
    [assets],
  );

  const metrics = useMemo(
    () => ({
      availableNow: assets.filter((asset) => asset.availability.availableNow).length,
      reserved: assets.filter((asset) => asset.status === "RESERVED").length,
      onHire: assets.filter((asset) => asset.status === "ON_HIRE").length,
      maintenance: assets.filter((asset) => asset.status === "MAINTENANCE").length,
      overdue: overdueBookings.length,
      pickupsToday: pickupsToday.length,
      returnsToday: returnsToday.length,
      onlineBookable: assets.filter((asset) => asset.isOnlineBookable).length,
    }),
    [assets, overdueBookings.length, pickupsToday.length, returnsToday.length],
  );

  const calendarDays = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const dayStart = date.getTime();
      const dayEnd = new Date(date);
      dayEnd.setDate(date.getDate() + 1);

      return {
        key: date.toISOString(),
        label: date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
        pickups: reservedBookings.filter((booking) => {
          const startsAt = new Date(booking.startsAt).getTime();
          return startsAt >= dayStart && startsAt < dayEnd.getTime();
        }),
        returns: checkedOutBookings.filter((booking) => {
          const dueBackAt = new Date(booking.dueBackAt).getTime();
          return dueBackAt >= dayStart && dueBackAt < dayEnd.getTime();
        }),
      };
    });
  }, [reservedBookings, checkedOutBookings]);

  const createAsset = async () => {
    if (!selectedVariantId) {
      error("Choose a bike variant before creating a hire asset.");
      return;
    }
    if (!assetTag.trim()) {
      error("Asset tag is required.");
      return;
    }

    setCreatingAsset(true);
    try {
      await apiPost("/api/hire/assets", {
        variantId: selectedVariantId,
        assetTag: assetTag.trim(),
        displayName: assetDisplayName.trim() || undefined,
        notes: assetNotes.trim() || undefined,
        storageLocation: assetStorageLocation.trim() || undefined,
        isOnlineBookable: assetOnlineBookable,
      });
      setAssetTag("");
      setAssetDisplayName("");
      setAssetNotes("");
      setAssetStorageLocation("");
      setAssetOnlineBookable(false);
      success("Hire asset created.");
      await loadHireData();
    } catch (createError) {
      error(createError instanceof Error ? createError.message : "Failed to create hire asset");
    } finally {
      setCreatingAsset(false);
    }
  };

  const createBooking = async () => {
    const hirePricePence = Number.parseInt(bookingHirePricePence, 10);
    const depositPence = Number.parseInt(bookingDepositPence, 10);

    if (!bookingAssetId) {
      error("Choose an available hire asset for the requested dates.");
      return;
    }
    if (!selectedCustomerId) {
      error("Choose a customer for the booking.");
      return;
    }
    if (Number.isNaN(new Date(bookingStartsAt).getTime()) || Number.isNaN(new Date(bookingDueBackAt).getTime())) {
      error("Start and due-back dates must be valid.");
      return;
    }
    if (new Date(bookingStartsAt).getTime() >= new Date(bookingDueBackAt).getTime()) {
      error("Due-back time must be after the start time.");
      return;
    }
    if (!Number.isInteger(hirePricePence) || hirePricePence < 0) {
      error("Hire price must be a non-negative whole number of pence.");
      return;
    }
    if (!Number.isInteger(depositPence) || depositPence < 0) {
      error("Deposit must be a non-negative whole number of pence.");
      return;
    }

    setCreatingBooking(true);
    try {
      await apiPost("/api/hire/bookings", {
        hireAssetId: bookingAssetId,
        customerId: selectedCustomerId,
        startsAt: toIsoFromLocalInput(bookingStartsAt),
        dueBackAt: toIsoFromLocalInput(bookingDueBackAt),
        hirePricePence,
        depositPence,
        notes: bookingNotes.trim() || undefined,
      });
      setBookingNotes("");
      success("Rental reservation created.");
      await loadHireData();
    } catch (createError) {
      error(createError instanceof Error ? createError.message : "Failed to create hire booking");
    } finally {
      setCreatingBooking(false);
    }
  };

  const saveAssetEdits = async () => {
    if (!editingAssetId || !assetEditor) {
      return;
    }

    setSavingAssetId(editingAssetId);
    try {
      await apiPatch(`/api/hire/assets/${encodeURIComponent(editingAssetId)}`, {
        displayName: assetEditor.displayName.trim() || undefined,
        notes: assetEditor.notes.trim() || undefined,
        storageLocation: assetEditor.storageLocation.trim() || undefined,
        isOnlineBookable: assetEditor.isOnlineBookable,
        status: assetEditor.status,
      });
      success("Hire asset updated.");
      setEditingAssetId(null);
      setAssetEditor(null);
      await loadHireData();
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to update hire asset");
    } finally {
      setSavingAssetId(null);
    }
  };

  const checkoutBooking = async (booking: HireBooking) => {
    const rawValue = checkoutDepositByBooking[booking.id] ?? `${booking.depositPence}`;
    const depositHeldPence = Number.parseInt(rawValue, 10);

    if (!Number.isInteger(depositHeldPence) || depositHeldPence < 0) {
      error("Deposit held must be a non-negative whole number of pence.");
      return;
    }

    setWorkingBookingId(booking.id);
    try {
      await apiPost(`/api/hire/bookings/${encodeURIComponent(booking.id)}/checkout`, {
        depositHeldPence,
        pickupNotes: pickupNotesByBooking[booking.id]?.trim() || undefined,
      });
      success("Bike checked out.");
      await loadHireData();
    } catch (checkoutError) {
      error(checkoutError instanceof Error ? checkoutError.message : "Failed to check out booking");
    } finally {
      setWorkingBookingId(null);
    }
  };

  const returnBooking = async (booking: HireBooking) => {
    setWorkingBookingId(booking.id);
    try {
      await apiPost(`/api/hire/bookings/${encodeURIComponent(booking.id)}/return`, {
        depositOutcome:
          booking.depositHeldPence > 0 ? (returnOutcomeByBooking[booking.id] ?? "RETURNED") : undefined,
        returnNotes: returnNotesByBooking[booking.id]?.trim() || undefined,
        damageNotes: damageNotesByBooking[booking.id]?.trim() || undefined,
        markAssetMaintenance: Boolean(markMaintenanceByBooking[booking.id]),
      });
      success("Bike returned.");
      await loadHireData();
    } catch (returnError) {
      error(returnError instanceof Error ? returnError.message : "Failed to return booking");
    } finally {
      setWorkingBookingId(null);
    }
  };

  const cancelBooking = async (bookingId: string) => {
    setWorkingBookingId(bookingId);
    try {
      await apiPost(`/api/hire/bookings/${encodeURIComponent(bookingId)}/cancel`, {
        cancellationReason: cancelReasonByBooking[bookingId]?.trim() || undefined,
      });
      success("Reservation cancelled.");
      await loadHireData();
    } catch (cancelError) {
      error(cancelError instanceof Error ? cancelError.message : "Failed to cancel booking");
    } finally {
      setWorkingBookingId(null);
    }
  };

  const openAssetEditor = (asset: HireAsset) => {
    setEditingAssetId(asset.id);
    setAssetEditor(toAssetEditorState(asset));
  };

  const renderBookingActions = (booking: HireBooking) => {
    if (booking.status === "RESERVED") {
      return (
        <div className="rental-ops-inline-form">
          <label>
            Deposit held
            <input
              type="number"
              min="0"
              step="1"
              value={checkoutDepositByBooking[booking.id] ?? `${booking.depositPence}`}
              onChange={(event) => setCheckoutDepositByBooking((current) => ({
                ...current,
                [booking.id]: event.target.value,
              }))}
            />
          </label>
          <label>
            Pickup notes
            <input
              value={pickupNotesByBooking[booking.id] ?? ""}
              onChange={(event) => setPickupNotesByBooking((current) => ({
                ...current,
                [booking.id]: event.target.value,
              }))}
              placeholder="ID check, helmet issued, lock included"
            />
          </label>
          <label>
            Cancel reason
            <input
              value={cancelReasonByBooking[booking.id] ?? ""}
              onChange={(event) => setCancelReasonByBooking((current) => ({
                ...current,
                [booking.id]: event.target.value,
              }))}
              placeholder="Customer no-show, date moved"
            />
          </label>
          <div className="actions-inline">
            <button
              type="button"
              onClick={() => void checkoutBooking(booking)}
              disabled={workingBookingId === booking.id}
            >
              Checkout bike
            </button>
            <button
              type="button"
              className="button-link"
              onClick={() => void cancelBooking(booking.id)}
              disabled={workingBookingId === booking.id}
            >
              Cancel reservation
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="rental-ops-inline-form">
        {booking.depositHeldPence > 0 ? (
          <label>
            Deposit outcome
            <select
              value={returnOutcomeByBooking[booking.id] ?? "RETURNED"}
              onChange={(event) => setReturnOutcomeByBooking((current) => ({
                ...current,
                [booking.id]: event.target.value as "RETURNED" | "KEPT",
              }))}
            >
              <option value="RETURNED">Return deposit</option>
              <option value="KEPT">Keep deposit</option>
            </select>
          </label>
        ) : null}
        <label>
          Return notes
          <input
            value={returnNotesByBooking[booking.id] ?? ""}
            onChange={(event) => setReturnNotesByBooking((current) => ({
              ...current,
              [booking.id]: event.target.value,
            }))}
            placeholder="Returned clean, accessories checked"
          />
        </label>
        <label>
          Damage / issue notes
          <input
            value={damageNotesByBooking[booking.id] ?? ""}
            onChange={(event) => setDamageNotesByBooking((current) => ({
              ...current,
              [booking.id]: event.target.value,
            }))}
            placeholder="Scratch on fork, brake rub, puncture"
          />
        </label>
        <label className="staff-toggle">
          <input
            type="checkbox"
            checked={Boolean(markMaintenanceByBooking[booking.id])}
            onChange={(event) => setMarkMaintenanceByBooking((current) => ({
              ...current,
              [booking.id]: event.target.checked,
            }))}
          />
          <span>Move bike to maintenance after return</span>
        </label>
        <div className="actions-inline">
          <button
            type="button"
            onClick={() => void returnBooking(booking)}
            disabled={workingBookingId === booking.id}
          >
            Return bike
          </button>
        </div>
      </div>
    );
  };

  const renderBookingTable = (rows: HireBooking[], emptyMessage: string) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Bike</th>
            <th>Timing</th>
            <th>Commercial</th>
            <th>Operational state</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6}>{emptyMessage}</td>
            </tr>
          ) : rows.map((booking) => (
            <tr key={booking.id}>
              <td>
                <Link to={`/customers/${booking.customer.id}`}>{booking.customer.name}</Link>
                <div className="table-secondary">{booking.customer.phone || booking.customer.email || "No contact recorded"}</div>
                <div className="table-secondary mono-text">{booking.id.slice(0, 8)}</div>
              </td>
              <td>
                <strong>{booking.hireAsset.assetTag}</strong>
                <div className="table-secondary">
                  {booking.hireAsset.variant.productName}
                  {booking.hireAsset.displayName ? ` · ${booking.hireAsset.displayName}` : ""}
                </div>
                <div className="table-secondary">
                  {booking.hireAsset.storageLocation || "No storage location set"}
                </div>
              </td>
              <td>
                {formatDateTime(booking.startsAt)}
                <div className="table-secondary">Due {formatDateTime(booking.dueBackAt)}</div>
                <div className="table-secondary">
                  {booking.status === "CHECKED_OUT"
                    ? `Checked out ${formatDateTime(booking.checkedOutAt)}`
                    : `Reserved ${formatDate(booking.createdAt)}`}
                </div>
              </td>
              <td>
                {formatMoney(booking.hirePricePence)}
                <div className="table-secondary">
                  Deposit {formatMoney(booking.depositPence)} · Held {formatMoney(booking.depositHeldPence)}
                </div>
                <div className="table-secondary">
                  Deposit {formatStatus(booking.depositStatus)}
                </div>
              </td>
              <td>
                <span className={getStatusBadgeClass(booking.operational.state)}>
                  {booking.operational.label}
                </span>
                <div className="table-secondary">{booking.operational.detail}</div>
                {booking.notes ? <div className="table-secondary">Booking: {booking.notes}</div> : null}
                {booking.pickupNotes ? <div className="table-secondary">Pickup: {booking.pickupNotes}</div> : null}
                {booking.returnNotes ? <div className="table-secondary">Return: {booking.returnNotes}</div> : null}
                {booking.damageNotes ? <div className="table-secondary">Damage: {booking.damageNotes}</div> : null}
                {booking.cancellationReason ? <div className="table-secondary">Cancelled: {booking.cancellationReason}</div> : null}
              </td>
              <td>{renderBookingActions(booking)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderCalendarView = () => (
    <>
      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Next 7 Days</h2>
            <p className="muted-text">
              Pickups and returns are grouped into an operational week so staff can see what is due out, what is due back, and where clashes may appear.
            </p>
          </div>
        </div>
        <div className="rental-ops-calendar" data-testid="rental-calendar-grid">
          {calendarDays.map((day) => (
            <article key={day.key} className="rental-ops-calendar-day">
              <div className="card-header-row">
                <strong>{day.label}</strong>
                <span className="table-secondary">
                  {day.pickups.length} pickup{day.pickups.length === 1 ? "" : "s"} · {day.returns.length} return{day.returns.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="rental-ops-calendar-list">
                {day.pickups.length === 0 && day.returns.length === 0 ? (
                  <p className="muted-text">No rental actions planned.</p>
                ) : (
                  <>
                    {day.pickups.map((booking) => (
                      <div key={`${booking.id}-pickup`} className="rental-ops-calendar-item">
                        <span className={getStatusBadgeClass("RESERVED")}>Pickup</span>
                        <strong>{formatTime(booking.startsAt)} · {booking.customer.name}</strong>
                        <span>{booking.hireAsset.assetTag} · {booking.hireAsset.variant.productName}</span>
                      </div>
                    ))}
                    {day.returns.map((booking) => (
                      <div key={`${booking.id}-return`} className="rental-ops-calendar-item">
                        <span className={getStatusBadgeClass(booking.operational.overdue ? "OVERDUE" : "DUE_BACK_TODAY")}>
                          {booking.operational.overdue ? "Overdue" : "Return"}
                        </span>
                        <strong>{formatTime(booking.dueBackAt)} · {booking.customer.name}</strong>
                        <span>{booking.hireAsset.assetTag} · {booking.hireAsset.variant.productName}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Today’s Action Centre</h2>
            <p className="muted-text">
              Keep collection, return, and problem follow-up separate so the front desk can act quickly without reading the whole rental history.
            </p>
          </div>
        </div>
        <div className="detail-grid" data-testid="rental-today-action-centre">
          <div className="rental-ops-highlight">
            <span className="status-badge">Pickups today</span>
            <strong>{pickupsToday.length}</strong>
            <p>{pickupsToday.length ? "Reserved bikes expected out today." : "No pickups scheduled today."}</p>
          </div>
          <div className="rental-ops-highlight">
            <span className="status-badge">Returns today</span>
            <strong>{returnsToday.length}</strong>
            <p>{returnsToday.length ? "Checked-out bikes due back today." : "No returns due today."}</p>
          </div>
          <div className="rental-ops-highlight">
            <span className={getStatusBadgeClass("OVERDUE")}>Overdue</span>
            <strong>{overdueBookings.length}</strong>
            <p>{overdueBookings.length ? "Customer follow-up required." : "No overdue bikes right now."}</p>
          </div>
          <div className="rental-ops-highlight">
            <span className="status-badge">Maintenance</span>
            <strong>{maintenanceAssets.length}</strong>
            <p>{maintenanceAssets.length ? "Fleet attention needed before these bikes can go out again." : "No bikes blocked in maintenance."}</p>
          </div>
        </div>
      </section>
    </>
  );

  const renderNewView = () => (
    <div className="detail-grid">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Create Rental Reservation</h2>
            <p className="muted-text">
              Search a customer, choose a date window, and only show fleet bikes that are free for that actual hire period.
            </p>
          </div>
        </div>

        <div className="inventory-adjustment-form">
          <label>
            Start
            <input type="datetime-local" value={bookingStartsAt} onChange={(event) => setBookingStartsAt(event.target.value)} />
          </label>
          <label>
            Due back
            <input type="datetime-local" value={bookingDueBackAt} onChange={(event) => setBookingDueBackAt(event.target.value)} />
          </label>
          <label>
            Available asset
            <select value={bookingAssetId} onChange={(event) => setBookingAssetId(event.target.value)}>
              <option value="">Choose hire asset</option>
              {windowAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.assetTag} · {asset.variant.productName}
                  {asset.displayName ? ` · ${asset.displayName}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Hire price (pence)
            <input
              type="number"
              min="0"
              step="1"
              value={bookingHirePricePence}
              onChange={(event) => setBookingHirePricePence(event.target.value)}
            />
          </label>
          <label>
            Deposit required (pence)
            <input
              type="number"
              min="0"
              step="1"
              value={bookingDepositPence}
              onChange={(event) => setBookingDepositPence(event.target.value)}
            />
          </label>
          <label>
            Find customer
            <input
              value={customerQuery}
              onChange={(event) => setCustomerQuery(event.target.value)}
              placeholder="Search by customer name, email, or phone"
            />
          </label>
        </div>

        <label className="inventory-adjustment-note">
          Booking notes
          <input
            value={bookingNotes}
            onChange={(event) => setBookingNotes(event.target.value)}
            placeholder="Included accessories, route plan, ID expectations"
          />
        </label>

        {selectedCustomer ? (
          <p className="muted-text">
            Selected customer: <strong>{selectedCustomer.name}</strong>
            {selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ""}
            {selectedCustomer.email ? ` · ${selectedCustomer.email}` : ""}
          </p>
        ) : (
          <p className="muted-text">Search for a customer above before creating the reservation.</p>
        )}

        <div className="actions-inline">
          <button type="button" onClick={() => void createBooking()} disabled={creatingBooking}>
            {creatingBooking ? "Creating..." : "Create Reservation"}
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Contact</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {customerQuery.trim().length < 2 ? (
                <tr>
                  <td colSpan={3}>Search for a customer by name, phone, or email.</td>
                </tr>
              ) : customerSearchLoading ? (
                <tr>
                  <td colSpan={3}>Searching customers...</td>
                </tr>
              ) : customerMatches.length === 0 ? (
                <tr>
                  <td colSpan={3}>No matching customers found.</td>
                </tr>
              ) : customerMatches.map((customer) => (
                <tr key={customer.id}>
                  <td><Link to={`/customers/${customer.id}`}>{customer.name}</Link></td>
                  <td>{customer.phone || customer.email || "-"}</td>
                  <td>
                    <button type="button" className="button-link" onClick={() => setSelectedCustomerId(customer.id)}>
                      Select
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Available For This Window</h2>
            <p className="muted-text">
              This availability check uses the requested hire period rather than a simple “free right now” flag, so future reservations do not block valid later bookings.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Location</th>
                <th>Status</th>
                <th>Next booking</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {windowAssetsLoading ? (
                <tr>
                  <td colSpan={5}>Checking availability...</td>
                </tr>
              ) : windowAssets.length === 0 ? (
                <tr>
                  <td colSpan={5}>No fleet bikes are available for the selected window.</td>
                </tr>
              ) : windowAssets.map((asset) => (
                <tr key={asset.id}>
                  <td>
                    <strong>{asset.assetTag}</strong>
                    <div className="table-secondary">
                      {asset.variant.productName}
                      {asset.displayName ? ` · ${asset.displayName}` : ""}
                    </div>
                  </td>
                  <td>{asset.storageLocation || "No location set"}</td>
                  <td>
                    <span className={getStatusBadgeClass(asset.status)}>{formatStatus(asset.status)}</span>
                    <div className="table-secondary">
                      {asset.isOnlineBookable ? "Online-bookable fleet bike" : "Internal-only hire asset"}
                    </div>
                  </td>
                  <td>
                    {asset.nextBooking ? (
                      <>
                        {formatDateTime(asset.nextBooking.startsAt)}
                        <div className="table-secondary">{asset.nextBooking.customer.name}</div>
                      </>
                    ) : (
                      "No upcoming reservation"
                    )}
                  </td>
                  <td>
                    <button type="button" className="button-link" onClick={() => setBookingAssetId(asset.id)}>
                      Use this bike
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Add Hire Bike</h2>
            <p className="muted-text">
              Build the fleet from real stock catalogue variants so pricing, branding, and bike identity stay grounded in the existing product setup.
            </p>
          </div>
        </div>

        <div className="inventory-adjustment-form">
          <label>
            Find catalogue variant
            <input
              value={variantQuery}
              onChange={(event) => setVariantQuery(event.target.value)}
              placeholder="Search by product, SKU, or barcode"
            />
          </label>
          <label>
            Asset tag
            <input
              value={assetTag}
              onChange={(event) => setAssetTag(event.target.value)}
              placeholder="HIRE-001"
            />
          </label>
          <label>
            Display name
            <input
              value={assetDisplayName}
              onChange={(event) => setAssetDisplayName(event.target.value)}
              placeholder="Weekend gravel demo bike"
            />
          </label>
          <label>
            Storage location
            <input
              value={assetStorageLocation}
              onChange={(event) => setAssetStorageLocation(event.target.value)}
              placeholder="Front hire rack"
            />
          </label>
          <label className="staff-toggle">
            <input
              type="checkbox"
              checked={assetOnlineBookable}
              onChange={(event) => setAssetOnlineBookable(event.target.checked)}
            />
            <span>Future online-bookable asset</span>
          </label>
        </div>

        <label className="inventory-adjustment-note">
          Asset notes
          <input
            value={assetNotes}
            onChange={(event) => setAssetNotes(event.target.value)}
            placeholder="Lock included, mudguards fitted, medium pedal size"
          />
        </label>

        <div className="actions-inline">
          <button type="button" onClick={() => void createAsset()} disabled={creatingAsset}>
            {creatingAsset ? "Creating..." : "Create Hire Asset"}
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Variant</th>
                <th>Barcode</th>
                <th>Retail</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {variantQuery.trim().length < 2 ? (
                <tr>
                  <td colSpan={4}>Search by product name, SKU, or barcode to find a bike variant.</td>
                </tr>
              ) : variantSearchLoading ? (
                <tr>
                  <td colSpan={4}>Searching catalogue variants...</td>
                </tr>
              ) : variantMatches.length === 0 ? (
                <tr>
                  <td colSpan={4}>No matching variants found.</td>
                </tr>
              ) : variantMatches.map((variant) => (
                <tr key={variant.id}>
                  <td>
                    <Link to={`/inventory/${variant.id}`}>{variant.product.name}</Link>
                    <div className="table-secondary">{variant.name || variant.option || variant.sku}</div>
                  </td>
                  <td><span className="mono-text">{variant.barcode || "-"}</span></td>
                  <td>{formatMoney(variant.retailPricePence)}</td>
                  <td>
                    <button type="button" className="button-link" onClick={() => setSelectedVariantId(variant.id)}>
                      Select
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const renderActiveView = () => (
    <>
      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Reserved Pickups</h2>
            <p className="muted-text">
              Reservations are kept separate from checked-out bikes so the team can complete deposit and handover steps cleanly at the desk.
            </p>
          </div>
        </div>
        {renderBookingTable(reservedBookings, "No reserved rentals waiting for pickup.")}
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>On Hire Now</h2>
            <p className="muted-text">
              Active hires keep due-back timing, outstanding deposit context, and issue logging close to the return action.
            </p>
          </div>
        </div>
        {renderBookingTable(checkedOutBookings, "No bikes are currently checked out.")}
      </section>
    </>
  );

  const renderReturnsView = () => (
    <>
      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Overdue Returns</h2>
            <p className="muted-text">
              Anything overdue should be treated as a live operational task, not hidden in general history.
            </p>
          </div>
        </div>
        {renderBookingTable(overdueBookings, "No overdue rentals right now.")}
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Due Back Today</h2>
            <p className="muted-text">
              Keep today’s planned returns visible so the front desk can prepare refunds, maintenance checks, and the next reservation.
            </p>
          </div>
        </div>
        {renderBookingTable(returnsToday, "No rental returns are due today.")}
      </section>
    </>
  );

  const renderHistoryView = () => (
    <section className="card">
      <div className="card-header-row">
        <div>
          <h2>Rental History</h2>
          <p className="muted-text">
            Completed and cancelled rentals keep commercial and issue notes attached so future decisions are grounded in real prior hires.
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Bike</th>
              <th>Outcome</th>
              <th>Dates</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {historyBookings.length === 0 ? (
              <tr>
                <td colSpan={5}>No completed or cancelled rentals yet.</td>
              </tr>
            ) : historyBookings.map((booking) => (
              <tr key={booking.id}>
                <td>
                  <Link to={`/customers/${booking.customer.id}`}>{booking.customer.name}</Link>
                  <div className="table-secondary mono-text">{booking.id.slice(0, 8)}</div>
                </td>
                <td>
                  {booking.hireAsset.assetTag}
                  <div className="table-secondary">{booking.hireAsset.variant.productName}</div>
                </td>
                <td>
                  <span className={getStatusBadgeClass(booking.status)}>
                    {formatStatus(booking.status)}
                  </span>
                  <div className="table-secondary">Deposit {formatStatus(booking.depositStatus)}</div>
                </td>
                <td>
                  {formatDate(booking.startsAt)} to {formatDate(booking.dueBackAt)}
                  <div className="table-secondary">
                    {booking.returnedAt
                      ? `Returned ${formatDateTime(booking.returnedAt)}`
                      : booking.cancelledAt
                        ? `Cancelled ${formatDateTime(booking.cancelledAt)}`
                        : formatDateTime(booking.updatedAt)}
                  </div>
                </td>
                <td>
                  {booking.notes || booking.returnNotes || booking.cancellationReason || booking.damageNotes || "-"}
                  {booking.damageNotes ? <div className="table-secondary">Damage: {booking.damageNotes}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="page-shell page-shell-workspace rental-ops-page" data-testid="bike-hire-page">
      <section className="card rental-ops-hero">
        <div className="card-header-row">
          <div>
            <p className="eyebrow">Bike Hire</p>
            <h1>Rental Operations</h1>
            <p className="muted-text">
              Run the hire fleet as a real operational area: reserve bikes against actual date windows, keep deposits and handovers explicit, and separate pickups, active hires, returns, and history.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/customers">Open customers</Link>
            <Link to="/inventory">Open inventory</Link>
            <Link to="/management/docs">Hire process docs</Link>
          </div>
        </div>

        <div className="rental-ops-nav" data-testid="rental-route-nav">
          {RENTAL_NAV.map((item) => (
            <Link
              key={item.view}
              to={item.to}
              className={`rental-ops-nav__link${rentalView === item.view ? " rental-ops-nav__link--active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="dashboard-metrics" style={{ marginTop: "20px" }}>
          <div className="dashboard-metric">
            <span className="dashboard-metric-value">{metrics.availableNow}</span>
            <span className="dashboard-metric-label">Available Now</span>
            <span className="dashboard-metric-detail">Fleet bikes free for a same-day walk-in or late booking.</span>
          </div>
          <div className="dashboard-metric">
            <span className="dashboard-metric-value">{metrics.reserved}</span>
            <span className="dashboard-metric-label">Reserved</span>
            <span className="dashboard-metric-detail">Future rentals already allocated to customers.</span>
          </div>
          <div className="dashboard-metric">
            <span className="dashboard-metric-value">{metrics.onHire}</span>
            <span className="dashboard-metric-label">On Hire</span>
            <span className="dashboard-metric-detail">Bikes currently checked out to customers.</span>
          </div>
          <div className="dashboard-metric">
            <span className="dashboard-metric-value">{metrics.overdue}</span>
            <span className="dashboard-metric-label">Overdue</span>
            <span className="dashboard-metric-detail">Live return exceptions that need follow-up.</span>
          </div>
          <div className="dashboard-metric">
            <span className="dashboard-metric-value">{metrics.maintenance}</span>
            <span className="dashboard-metric-label">Maintenance</span>
            <span className="dashboard-metric-detail">Fleet bikes blocked for prep or repair.</span>
          </div>
          <div className="dashboard-metric">
            <span className="dashboard-metric-value">{metrics.onlineBookable}</span>
            <span className="dashboard-metric-label">Online-ready</span>
            <span className="dashboard-metric-detail">Fleet bikes marked for future web booking expansion.</span>
          </div>
        </div>
      </section>

      {rentalView === "calendar" ? renderCalendarView() : null}
      {rentalView === "new" ? renderNewView() : null}
      {rentalView === "active" ? renderActiveView() : null}
      {rentalView === "returns" ? renderReturnsView() : null}
      {rentalView === "history" ? renderHistoryView() : null}

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Fleet Status</h2>
            <p className="muted-text">
              Keep every hire bike tied to a product identity, a storage location, and a clear operational state so staff can trust what is safe to send out.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Location</th>
                <th>Status</th>
                <th>Availability</th>
                <th>Upcoming</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {assets.length === 0 ? (
                <tr>
                  <td colSpan={6}>No hire assets yet. Add your first fleet bike from the rental setup view.</td>
                </tr>
              ) : assets.map((asset) => (
                <tr key={asset.id}>
                  <td>
                    <strong>{asset.assetTag}</strong>
                    <div className="table-secondary">
                      {asset.variant.productName}
                      {asset.displayName ? ` · ${asset.displayName}` : ""}
                    </div>
                    <div className="table-secondary">{asset.notes || "No fleet note recorded"}</div>
                  </td>
                  <td>
                    {asset.storageLocation || "No location set"}
                    <div className="table-secondary">
                      {asset.isOnlineBookable ? "Future online-bookable" : "Internal rental desk only"}
                    </div>
                  </td>
                  <td>
                    <span className={getStatusBadgeClass(asset.status)}>{formatStatus(asset.status)}</span>
                    <div className="table-secondary">Stored status {formatStatus(asset.storedStatus)}</div>
                  </td>
                  <td>
                    {asset.availability.availableNow ? "Available now" : "Not available now"}
                    <div className="table-secondary">
                      Next free {formatDateTime(asset.availability.nextAvailableAt)}
                    </div>
                    <div className="table-secondary">
                      {asset.availability.reservedCount} reserved · {asset.availability.checkedOutCount} on hire
                    </div>
                  </td>
                  <td>
                    {asset.upcomingBookings.length === 0 ? (
                      "No active bookings"
                    ) : (
                      asset.upcomingBookings.slice(0, 2).map((booking) => (
                        <div key={booking.id} className="table-secondary">
                          {formatStatus(booking.status)} · {formatDateTime(booking.startsAt)} · {booking.customer.name}
                        </div>
                      ))
                    )}
                  </td>
                  <td>
                    <div className="actions-inline">
                      <button type="button" className="button-link" onClick={() => openAssetEditor(asset)}>
                        Edit fleet setup
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editingAssetId && assetEditor ? (
          <div className="rental-ops-asset-editor">
            <div className="card-header-row">
              <div>
                <h3 style={{ margin: 0 }}>Update Hire Asset</h3>
                <p className="muted-text" style={{ margin: "6px 0 0" }}>
                  Storage, online-bookable readiness, and manual maintenance blocks live here. Reservation and on-hire states remain system-managed.
                </p>
              </div>
              <button type="button" onClick={() => {
                setEditingAssetId(null);
                setAssetEditor(null);
              }}>
                Close
              </button>
            </div>

            <div className="inventory-adjustment-form">
              <label>
                Display name
                <input
                  value={assetEditor.displayName}
                  onChange={(event) => setAssetEditor((current) => current ? {
                    ...current,
                    displayName: event.target.value,
                  } : current)}
                />
              </label>
              <label>
                Storage location
                <input
                  value={assetEditor.storageLocation}
                  onChange={(event) => setAssetEditor((current) => current ? {
                    ...current,
                    storageLocation: event.target.value,
                  } : current)}
                />
              </label>
              <label>
                Fleet status
                <select
                  value={assetEditor.status}
                  onChange={(event) => setAssetEditor((current) => current ? {
                    ...current,
                    status: event.target.value as "AVAILABLE" | "MAINTENANCE" | "RETIRED",
                  } : current)}
                >
                  <option value="AVAILABLE">Available / bookable</option>
                  <option value="MAINTENANCE">Maintenance block</option>
                  <option value="RETIRED">Retired from fleet</option>
                </select>
              </label>
              <label className="staff-toggle">
                <input
                  type="checkbox"
                  checked={assetEditor.isOnlineBookable}
                  onChange={(event) => setAssetEditor((current) => current ? {
                    ...current,
                    isOnlineBookable: event.target.checked,
                  } : current)}
                />
                <span>Mark as future online-bookable</span>
              </label>
            </div>

            <label className="inventory-adjustment-note">
              Asset notes
              <input
                value={assetEditor.notes}
                onChange={(event) => setAssetEditor((current) => current ? {
                  ...current,
                  notes: event.target.value,
                } : current)}
              />
            </label>

            <div className="actions-inline">
              <button type="button" onClick={() => void saveAssetEdits()} disabled={savingAssetId === editingAssetId}>
                {savingAssetId === editingAssetId ? "Saving..." : "Save Hire Asset"}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {rentalView !== "history" ? (
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Recent Closed Rentals</h2>
              <p className="muted-text">
                Keep the latest completed and cancelled rentals close to the live desk so staff can spot repeat issues without leaving the rental area.
              </p>
            </div>
            <Link to="/rental/history" className="button-link">Open full history</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Bike</th>
                  <th>Outcome</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {historyBookings.slice(0, 6).length === 0 ? (
                  <tr>
                    <td colSpan={4}>No recent closed rentals yet.</td>
                  </tr>
                ) : historyBookings.slice(0, 6).map((booking) => (
                  <tr key={booking.id}>
                    <td>{booking.customer.name}</td>
                    <td>{booking.hireAsset.assetTag} · {booking.hireAsset.variant.productName}</td>
                    <td>{formatStatus(booking.status)}</td>
                    <td>{formatDateTime(booking.returnedAt ?? booking.cancelledAt ?? booking.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {loading ? <p className="muted-text">Refreshing rental operations…</p> : null}
    </div>
  );
};
