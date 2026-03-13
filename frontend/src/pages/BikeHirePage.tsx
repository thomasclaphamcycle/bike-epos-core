import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

type HireAssetStatus = "AVAILABLE" | "RESERVED" | "ON_HIRE" | "MAINTENANCE" | "RETIRED";
type HireBookingStatus = "RESERVED" | "CHECKED_OUT" | "RETURNED" | "CANCELLED";
type HireDepositStatus = "NONE" | "HELD" | "RETURNED" | "KEPT";

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
  activeBooking: {
    id: string;
    status: HireBookingStatus;
    startsAt: string;
    dueBackAt: string;
    customer: {
      id: string;
      name: string;
    };
  } | null;
};

type HireAssetListResponse = {
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
  hirePricePence: number;
  depositPence: number;
  depositHeldPence: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  hireAsset: {
    id: string;
    assetTag: string;
    displayName: string | null;
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
  bookings: HireBooking[];
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatStatus = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const formatDateTime = (value: string | null) => (value ? new Date(value).toLocaleString() : "-");

const toLocalDateTimeInput = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  const hours = `${value.getHours()}`.padStart(2, "0");
  const minutes = `${value.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const toIsoFromLocalInput = (value: string) => new Date(value).toISOString();

export const BikeHirePage = () => {
  const { error, success } = useToasts();
  const [assets, setAssets] = useState<HireAsset[]>([]);
  const [bookings, setBookings] = useState<HireBooking[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingAsset, setCreatingAsset] = useState(false);
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

  const [checkoutDepositByBooking, setCheckoutDepositByBooking] = useState<Record<string, string>>({});
  const [returnOutcomeByBooking, setReturnOutcomeByBooking] = useState<Record<string, "RETURNED" | "KEPT">>({});

  const loadHireData = async () => {
    setLoading(true);
    const [assetResult, bookingResult] = await Promise.allSettled([
      apiGet<HireAssetListResponse>("/api/hire/assets?take=200"),
      apiGet<HireBookingListResponse>("/api/hire/bookings?take=200"),
    ]);

    if (assetResult.status === "fulfilled") {
      setAssets(assetResult.value.assets || []);
    } else {
      setAssets([]);
      error(assetResult.reason instanceof Error ? assetResult.reason.message : "Failed to load hire fleet");
    }

    if (bookingResult.status === "fulfilled") {
      setBookings(bookingResult.value.bookings || []);
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
        const nextMatches = payload.variants || [];
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
        const nextMatches = payload.customers || [];
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

  const availableAssets = useMemo(
    () => assets.filter((asset) => asset.status === "AVAILABLE"),
    [assets],
  );

  useEffect(() => {
    if (bookingAssetId && availableAssets.some((asset) => asset.id === bookingAssetId)) {
      return;
    }
    setBookingAssetId(availableAssets[0]?.id ?? "");
  }, [availableAssets, bookingAssetId]);

  const metrics = useMemo(() => {
    const onHire = bookings.filter((booking) => booking.status === "CHECKED_OUT");
    const overdue = onHire.filter((booking) => new Date(booking.dueBackAt).getTime() < Date.now());
    return {
      availableAssets: assets.filter((asset) => asset.status === "AVAILABLE").length,
      reservedAssets: assets.filter((asset) => asset.status === "RESERVED").length,
      onHireAssets: assets.filter((asset) => asset.status === "ON_HIRE").length,
      overdueBookings: overdue.length,
    };
  }, [assets, bookings]);

  const activeBookings = useMemo(
    () => bookings.filter((booking) => booking.status === "RESERVED" || booking.status === "CHECKED_OUT"),
    [bookings],
  );

  const recentHistory = useMemo(
    () => bookings.filter((booking) => booking.status === "RETURNED" || booking.status === "CANCELLED").slice(0, 8),
    [bookings],
  );

  const selectedVariant = variantMatches.find((variant) => variant.id === selectedVariantId) ?? null;
  const selectedCustomer = customerMatches.find((customer) => customer.id === selectedCustomerId) ?? null;

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
      });
      setAssetTag("");
      setAssetDisplayName("");
      setAssetNotes("");
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
      error("Choose an available hire asset.");
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
      success("Hire booking created.");
      await loadHireData();
    } catch (createError) {
      error(createError instanceof Error ? createError.message : "Failed to create hire booking");
    } finally {
      setCreatingBooking(false);
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
      });
      success("Hire booking checked out.");
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
      });
      success("Hire booking returned.");
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
      await apiPost(`/api/hire/bookings/${encodeURIComponent(bookingId)}/cancel`);
      success("Hire booking cancelled.");
      await loadHireData();
    } catch (cancelError) {
      error(cancelError instanceof Error ? cancelError.message : "Failed to cancel booking");
    } finally {
      setWorkingBookingId(null);
    }
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <p className="eyebrow">Bike Hire</p>
            <h1>Bike Hire Desk</h1>
            <p className="muted-text">
              First-pass hire workflow for reserving fleet bikes, checking them out, and returning them cleanly.
              Hire assets stay separate from normal sale stock, but still link back to the live product catalogue.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/customers">Open customers</Link>
            <Link to="/inventory">Open inventory</Link>
            <Link to="/management/docs">Hire process docs</Link>
          </div>
        </div>

        <div className="dashboard-metrics" style={{ marginTop: "20px" }}>
          <div className="dashboard-metric">
            <span className="dashboard-metric-value">{metrics.availableAssets}</span>
            <span className="dashboard-metric-label">Available Bikes</span>
            <span className="dashboard-metric-detail">Ready for a new reservation or walk-in hire</span>
          </div>
          <div className="dashboard-metric">
            <span className="dashboard-metric-value">{metrics.reservedAssets}</span>
            <span className="dashboard-metric-label">Reserved</span>
            <span className="dashboard-metric-detail">Held for upcoming customer collection</span>
          </div>
          <div className="dashboard-metric">
            <span className="dashboard-metric-value">{metrics.onHireAssets}</span>
            <span className="dashboard-metric-label">On Hire</span>
            <span className="dashboard-metric-detail">Currently checked out to customers</span>
          </div>
          <div className="dashboard-metric">
            <span className="dashboard-metric-value">{metrics.overdueBookings}</span>
            <span className="dashboard-metric-label">Overdue Returns</span>
            <span className="dashboard-metric-detail">Checked-out bikes past their due-back time</span>
          </div>
        </div>
      </section>

      <div className="detail-grid">
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Add Hire Bike</h2>
              <p className="muted-text">
                Link a real hire asset to an existing product variant so pricing and product identity stay aligned.
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
                placeholder="Workshop gravel bike"
              />
            </label>
          </div>

          <label className="inventory-adjustment-note">
            Asset notes
            <input
              value={assetNotes}
              onChange={(event) => setAssetNotes(event.target.value)}
              placeholder="Optional setup or condition note"
            />
          </label>

          {selectedVariant ? (
            <p className="muted-text">
              Selected: <strong>{selectedVariant.product.name}</strong>{" "}
              {selectedVariant.name || selectedVariant.option ? `(${selectedVariant.name || selectedVariant.option}) ` : ""}
              at {formatMoney(selectedVariant.retailPricePence)} retail.
            </p>
          ) : (
            <p className="muted-text">
              Search for a product variant above, then pick the fleet bike you want to track separately as a hire asset.
            </p>
          )}

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
                  <th>Price</th>
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

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Create Hire Booking</h2>
              <p className="muted-text">
                Reserve an available hire bike for a customer, then check it out once deposit handling is complete.
              </p>
            </div>
          </div>

          <div className="inventory-adjustment-form">
            <label>
              Available asset
              <select value={bookingAssetId} onChange={(event) => setBookingAssetId(event.target.value)}>
                <option value="">Choose hire asset</option>
                {availableAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.assetTag} · {asset.variant.productName}
                    {asset.displayName ? ` · ${asset.displayName}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start
              <input type="datetime-local" value={bookingStartsAt} onChange={(event) => setBookingStartsAt(event.target.value)} />
            </label>
            <label>
              Due back
              <input type="datetime-local" value={bookingDueBackAt} onChange={(event) => setBookingDueBackAt(event.target.value)} />
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
              placeholder="Optional hire terms or condition note"
            />
          </label>

          {selectedCustomer ? (
            <p className="muted-text">
              Selected customer: <strong>{selectedCustomer.name}</strong>
              {selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ""}
              {selectedCustomer.email ? ` · ${selectedCustomer.email}` : ""}
            </p>
          ) : (
            <p className="muted-text">
              Search for a customer above, or create a new one from the customer screen before reserving a bike.
            </p>
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
              <h2>Live Hire Queue</h2>
              <p className="muted-text">
                Reserved bookings are waiting for collection. Checked-out bookings are currently on hire and should be monitored for overdue returns.
              </p>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Bike</th>
                  <th>Customer</th>
                  <th>Timing</th>
                  <th>Charges</th>
                  <th>Status</th>
                  <th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {activeBookings.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No active hire bookings. Reserve a bike above to start a hire flow.</td>
                  </tr>
                ) : activeBookings.map((booking) => {
                  const isOverdue =
                    booking.status === "CHECKED_OUT" && new Date(booking.dueBackAt).getTime() < Date.now();
                  return (
                    <tr key={booking.id}>
                      <td>
                        <span className="mono-text">{booking.id.slice(0, 8)}</span>
                        <div className="table-secondary">{booking.notes || "No extra note"}</div>
                      </td>
                      <td>
                        {booking.hireAsset.assetTag}
                        <div className="table-secondary">
                          {booking.hireAsset.variant.productName}
                          {booking.hireAsset.displayName ? ` · ${booking.hireAsset.displayName}` : ""}
                        </div>
                      </td>
                      <td><Link to={`/customers/${booking.customer.id}`}>{booking.customer.name}</Link></td>
                      <td>
                        {formatDateTime(booking.startsAt)}
                        <div className="table-secondary">
                          Due {formatDateTime(booking.dueBackAt)}
                          {isOverdue ? " · overdue" : ""}
                        </div>
                      </td>
                      <td>
                        {formatMoney(booking.hirePricePence)}
                        <div className="table-secondary">
                          Deposit {formatMoney(booking.depositPence)} · Held {formatMoney(booking.depositHeldPence)}
                        </div>
                      </td>
                      <td>
                        {formatStatus(booking.status)}
                        <div className="table-secondary">Deposit {formatStatus(booking.depositStatus)}</div>
                      </td>
                      <td>
                        {booking.status === "RESERVED" ? (
                          <div className="actions-inline">
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
                            <button
                              type="button"
                              className="button-link"
                              onClick={() => void checkoutBooking(booking)}
                              disabled={workingBookingId === booking.id}
                            >
                              Checkout
                            </button>
                            <button
                              type="button"
                              className="button-link"
                              onClick={() => void cancelBooking(booking.id)}
                              disabled={workingBookingId === booking.id}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="actions-inline">
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
                            <button
                              type="button"
                              className="button-link"
                              onClick={() => void returnBooking(booking)}
                              disabled={workingBookingId === booking.id}
                            >
                              Return bike
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Hire Fleet</h2>
              <p className="muted-text">
                Separate fleet records keep hire operations visible without changing normal sale stock.
              </p>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Variant</th>
                  <th>Status</th>
                  <th>Current booking</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {assets.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No hire assets yet. Add your first fleet bike above.</td>
                  </tr>
                ) : assets.map((asset) => (
                  <tr key={asset.id}>
                    <td>
                      <span className="mono-text">{asset.assetTag}</span>
                      <div className="table-secondary">{asset.displayName || "No display name"}</div>
                    </td>
                    <td>
                      <Link to={`/inventory/${asset.variant.id}`}>{asset.variant.productName}</Link>
                      <div className="table-secondary">{asset.variant.variantName || asset.variant.sku}</div>
                    </td>
                    <td>{formatStatus(asset.status)}</td>
                    <td>
                      {asset.activeBooking ? (
                        <>
                          <Link to={`/customers/${asset.activeBooking.customer.id}`}>{asset.activeBooking.customer.name}</Link>
                          <div className="table-secondary">
                            {formatStatus(asset.activeBooking.status)} · due {formatDateTime(asset.activeBooking.dueBackAt)}
                          </div>
                        </>
                      ) : (
                        "Available now"
                      )}
                    </td>
                    <td>{asset.notes || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Recent Completed Hire Activity</h2>
              <p className="muted-text">
                Returned and cancelled bookings stay visible here so the front desk can verify deposit outcomes and bike turnaround.
              </p>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Bike</th>
                  <th>Customer</th>
                  <th>Finished</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {recentHistory.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No completed hire bookings yet.</td>
                  </tr>
                ) : recentHistory.map((booking) => (
                  <tr key={booking.id}>
                    <td><span className="mono-text">{booking.id.slice(0, 8)}</span></td>
                    <td>{booking.hireAsset.assetTag} · {booking.hireAsset.variant.productName}</td>
                    <td>{booking.customer.name}</td>
                    <td>{formatDateTime(booking.returnedAt || booking.updatedAt)}</td>
                    <td>
                      {formatStatus(booking.status)}
                      <div className="table-secondary">Deposit {formatStatus(booking.depositStatus)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {loading ? <p className="muted-text">Refreshing hire desk...</p> : null}
    </div>
  );
};
