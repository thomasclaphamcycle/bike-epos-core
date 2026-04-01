import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch } from "../api/client";
import { PublicSiteLayout } from "../components/PublicSiteLayout";
import { useCustomerAccount } from "../customerAccount/CustomerAccountContext";
import {
  publicSitePaths,
  secureCustomerTouchpoints,
} from "../features/publicSite/siteContent";

type ManageBookingResponse = {
  id: string;
  status: string;
  scheduledDate: string | null;
  createdAt: string;
  updatedAt: string;
  manageTokenExpiresAt: string | null;
  source: string;
  depositRequiredPence: number;
  depositStatus: string;
  notes: string | null;
  bookingRequest: {
    bikeDescription: string | null;
    serviceLabel: string | null;
    preferredTime: string | null;
    serviceRequest: string | null;
    additionalNotes: string | null;
    requestedDateLabel: string | null;
    timingExpectation: string;
  };
  customer: {
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
  } | null;
};

type WorkshopAvailabilityDay = {
  date: string;
  bookedCount: number;
  maxBookings: number;
  isBookable: boolean;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatDateLabel = (value: string | null | undefined) => {
  if (!value) {
    return "To be confirmed";
  }

  const date = new Date(value.length > 10 ? value : `${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

const formatDateTimeLabel = (value: string | null | undefined) => {
  if (!value) {
    return "Not set";
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

const BOOKING_JOURNEY_STEPS = [
  "Request sent",
  "Workshop confirms timing",
  "Bike in workshop",
  "Ready to collect",
  "Collected",
];

const MANAGE_PAGE_GUIDE_CARDS = [
  {
    title: "This page tracks the booking request",
    detail:
      "Use it for the requested date, booking details, and the first secure stage of the workshop journey.",
  },
  secureCustomerTouchpoints[1],
  {
    title: "Collection updates arrive later",
    detail:
      "When the job moves further on, secure workshop updates become the clearest place to see progress, readiness, and payment expectations.",
  },
];

const getBookingJourneyIndex = (status: string) => {
  switch (status) {
    case "OPEN":
    case "BOOKED":
      return 1;
    case "BIKE_ARRIVED":
    case "IN_PROGRESS":
    case "WAITING_FOR_APPROVAL":
    case "WAITING_FOR_PARTS":
    case "ON_HOLD":
      return 2;
    case "READY_FOR_COLLECTION":
      return 3;
    case "COMPLETED":
    case "CLOSED":
      return 4;
    default:
      return 0;
  }
};

const getBookingStatusCopy = (status: string) => {
  switch (status) {
    case "OPEN":
    case "BOOKED":
      return {
        label: "Booked",
        detail: "Your bike is booked in and the workshop will confirm the next step if timing changes.",
      };
    case "BIKE_ARRIVED":
      return {
        label: "Bike arrived",
        detail: "The workshop has your bike and will move it onto the next repair step shortly.",
      };
    case "IN_PROGRESS":
      return {
        label: "In progress",
        detail: "Your bike is currently with the workshop.",
      };
    case "WAITING_FOR_APPROVAL":
      return {
        label: "Waiting for approval",
        detail: "The workshop is waiting for a customer decision before bench work can continue.",
      };
    case "WAITING_FOR_PARTS":
      return {
        label: "Waiting for parts",
        detail: "The workshop is waiting on stock before the repair can continue.",
      };
    case "ON_HOLD":
      return {
        label: "On hold",
        detail: "The workshop has paused this job and will update you when it can move again.",
      };
    case "READY_FOR_COLLECTION":
      return {
        label: "Ready for collection",
        detail: "The workshop has marked the bike ready to collect.",
      };
    case "COMPLETED":
    case "CLOSED":
      return {
        label: "Completed",
        detail: "This workshop job has been completed.",
      };
    case "CANCELLED":
      return {
        label: "Cancelled",
        detail: "This booking has been cancelled.",
      };
    default:
      return {
        label: status,
        detail: "The workshop team will keep you updated if anything changes.",
      };
  }
};

export const PublicWorkshopBookingManagePage = () => {
  const location = useLocation();
  const { token } = useParams();
  const { session } = useCustomerAccount();
  const [searchParams] = useSearchParams();
  const [payload, setPayload] = useState<ManageBookingResponse | null>(null);
  const [availability, setAvailability] = useState<WorkshopAvailabilityDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(
    searchParams.get("created") === "1"
      ? "Your workshop request has been sent. You can use this page to check the request details and reschedule the preferred date if needed."
      : null,
  );
  const [rescheduleDate, setRescheduleDate] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!token) {
        setError("Booking link is missing.");
        setLoading(false);
        return;
      }

      try {
        const booking = await apiGet<ManageBookingResponse>(
          `/api/workshop-bookings/manage/${encodeURIComponent(token)}`,
        );
        if (cancelled) {
          return;
        }
        setPayload(booking);
        setRescheduleDate(booking.scheduledDate?.slice(0, 10) ?? "");

        const start = booking.scheduledDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
        const startDate = new Date(`${start}T00:00:00.000Z`);
        const endDate = new Date(startDate);
        endDate.setUTCDate(endDate.getUTCDate() + 20);
        const availabilityPayload = await apiGet<WorkshopAvailabilityDay[]>(
          `/api/workshop/availability?from=${encodeURIComponent(start)}&to=${encodeURIComponent(endDate.toISOString().slice(0, 10))}`,
        );
        if (!cancelled) {
          setAvailability(availabilityPayload);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load this booking.");
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
  }, [token]);

  const statusCopy = useMemo(
    () => getBookingStatusCopy(payload?.status ?? "BOOKED"),
    [payload?.status],
  );
  const accountAccessHref = useMemo(() => {
    const params = new URLSearchParams();
    const customerEmail = payload?.customer?.email || "";
    if (customerEmail) {
      params.set("email", customerEmail);
    }
    params.set("returnTo", location.pathname + location.search);
    return `${publicSitePaths.accountLogin}?${params.toString()}`;
  }, [location.pathname, location.search, payload?.customer?.email]);

  const canReschedule = payload?.status === "BOOKED" || payload?.status === "OPEN";

  const handleReschedule = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !rescheduleDate) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const booking = await apiPatch<ManageBookingResponse>(
        `/api/workshop-bookings/manage/${encodeURIComponent(token)}`,
        { scheduledDate: rescheduleDate },
      );
      setPayload(booking);
      setSuccess("Your requested workshop date has been updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update the booking date.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PublicSiteLayout currentNav="repairs">
      <div className="customer-booking-shell">
        <nav className="public-site-breadcrumbs" aria-label="Manage booking breadcrumbs">
          <Link to={publicSitePaths.home}>Overview</Link>
          <span>/</span>
          <Link to={publicSitePaths.bookWorkshop}>Book workshop</Link>
          <span>/</span>
          <span>Manage booking</span>
        </nav>

        <section className="customer-booking-card">
          <div className="customer-booking-hero">
            <div>
              <p className="customer-booking-kicker">Manage booking</p>
              <h1>Track your workshop booking request</h1>
              <p className="customer-booking-intro">
                This secure page keeps the workshop request, current status, and next step in one place. If the
                workshop later needs approval for extra work, they will send a separate secure quote link for that
                decision.
              </p>
            </div>
            <div className="customer-booking-hero-card">
              <strong>{statusCopy.label}</strong>
              <p>{statusCopy.detail}</p>
              {payload ? <p>{payload.bookingRequest.timingExpectation}</p> : null}
              {payload?.manageTokenExpiresAt ? (
                <p>Secure link valid until {formatDateTimeLabel(payload.manageTokenExpiresAt)}</p>
              ) : null}
            </div>
          </div>

          <div className="customer-booking-topbar">
            <Link to={publicSitePaths.repairs}>Repair journey</Link>
            <Link to={publicSitePaths.bookWorkshop}>New booking request</Link>
            <Link to={publicSitePaths.contact}>Contact the shop</Link>
          </div>

          <section className="customer-booking-prep-grid">
            {MANAGE_PAGE_GUIDE_CARDS.map((card) => (
              <article key={card.title} className="customer-booking-prep-card">
                <strong>{card.title}</strong>
                <p>{card.detail}</p>
              </article>
            ))}
          </section>

          {session.authenticated && session.account?.email === payload?.customer?.email ? (
            <div className="customer-account-inline-banner customer-account-inline-banner--soft">
              <strong>This booking is linked to your customer account.</strong>
              <p>It will stay visible from your account dashboard alongside approvals, progress updates, and saved bikes.</p>
              <Link className="button-link" to={publicSitePaths.account}>
                Open customer account
              </Link>
            </div>
          ) : payload?.customer?.email ? (
            <div className="customer-account-inline-banner customer-account-inline-banner--soft">
              <strong>Want a persistent workshop login as well?</strong>
              <p>
                You can keep using this secure booking link, and you can also add customer account access for the
                same email address so the wider workshop journey stays together.
              </p>
              <Link className="button-link" to={accountAccessHref}>
                Set up customer access
              </Link>
            </div>
          ) : null}

          {payload ? (
            <section className="customer-booking-journey" data-testid="customer-booking-manage-journey">
              {BOOKING_JOURNEY_STEPS.map((label, index) => {
                const active = index === getBookingJourneyIndex(payload.status);
                const complete = index < getBookingJourneyIndex(payload.status);
                return (
                  <article
                    key={label}
                    className={`customer-booking-journey-step${active ? " customer-booking-journey-step--active" : ""}${complete ? " customer-booking-journey-step--complete" : ""}`}
                  >
                    <span className="customer-booking-journey-number">{index + 1}</span>
                    <div>
                      <strong>{label}</strong>
                      {active ? <p>{statusCopy.detail}</p> : null}
                    </div>
                  </article>
                );
              })}
            </section>
          ) : null}

          {loading ? <p>Loading booking…</p> : null}
          {success ? <p className="success-text">{success}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}

          {payload ? (
            <div className="customer-booking-manage-grid">
              <section className="customer-booking-section">
                <div className="customer-booking-section-header">
                  <div>
                    <h2>Booking summary</h2>
                    <p>Everything here is tied to this secure booking link.</p>
                  </div>
                </div>

                <div className="customer-booking-summary-grid">
                  <article className="customer-booking-summary-card customer-booking-summary-card--highlight">
                    <span>What happens now</span>
                    <strong>{statusCopy.label}</strong>
                    <p>{statusCopy.detail}</p>
                  </article>
                  <article className="customer-booking-summary-card">
                    <span>Requested date</span>
                    <strong>{formatDateLabel(payload.scheduledDate)}</strong>
                    <p>{payload.bookingRequest.preferredTime || "Any time"}</p>
                  </article>
                  <article className="customer-booking-summary-card">
                    <span>Service request</span>
                    <strong>{payload.bookingRequest.serviceLabel || "General workshop request"}</strong>
                    <p>{payload.bookingRequest.serviceRequest || "The workshop team will review the request details."}</p>
                  </article>
                  <article className="customer-booking-summary-card">
                    <span>Deposit and secure link</span>
                    <strong>
                      {payload.depositRequiredPence > 0 ? formatMoney(payload.depositRequiredPence) : "No deposit"}
                    </strong>
                    <p>
                      {payload.depositStatus === "PAID"
                        ? "Deposit received."
                        : "If a deposit is needed, the shop will confirm how to pay it."}
                      {" "}
                      {payload.manageTokenExpiresAt
                        ? `This secure link stays active until ${formatDateTimeLabel(payload.manageTokenExpiresAt)}.`
                        : ""}
                    </p>
                  </article>
                </div>

                <div className="customer-booking-detail-grid">
                  <article className="customer-booking-detail-card">
                    <h3>Bike details</h3>
                    <p>{payload.bookingRequest.bikeDescription || "Bike details will be confirmed by the workshop."}</p>
                  </article>
                  <article className="customer-booking-detail-card">
                    <h3>Contact details</h3>
                    <p>
                      {payload.customer?.firstName} {payload.customer?.lastName}
                    </p>
                    <p>{payload.customer?.phone || "No phone saved"}</p>
                    <p>{payload.customer?.email || "No email saved"}</p>
                  </article>
                  <article className="customer-booking-detail-card">
                    <h3>Extra notes</h3>
                    <p>{payload.bookingRequest.additionalNotes || "No extra notes added."}</p>
                  </article>
                  <article className="customer-booking-detail-card">
                    <h3>What happens next</h3>
                    <p>The shop will review the request, confirm timing if needed, and keep you updated if approval or collection details become important.</p>
                  </article>
                  <article className="customer-booking-detail-card">
                    <h3>How quotes and updates arrive</h3>
                    <p>If the workshop needs your approval for extra work, they will send a separate secure workshop link so you can review the quote clearly before they continue.</p>
                  </article>
                  <article className="customer-booking-detail-card">
                    <h3>Last booking activity</h3>
                    <p>Created {formatDateTimeLabel(payload.createdAt)}</p>
                    <p>Last updated {formatDateTimeLabel(payload.updatedAt)}</p>
                  </article>
                </div>
              </section>

              <section className="customer-booking-section">
                <div className="customer-booking-section-header">
                  <div>
                    <h2>Requested date</h2>
                    <p>Update your preferred drop-off date while the request is still waiting for confirmation.</p>
                  </div>
                </div>

                {canReschedule ? (
                  <form className="customer-booking-reschedule" onSubmit={handleReschedule}>
                    <div className="customer-booking-date-grid">
                      {availability.map((day) => (
                        <button
                          key={day.date}
                          type="button"
                          className={
                            rescheduleDate === day.date
                              ? "customer-booking-date-pill customer-booking-date-pill--selected"
                              : "customer-booking-date-pill"
                          }
                          onClick={() => setRescheduleDate(day.date)}
                          disabled={!day.isBookable}
                        >
                          <strong>{formatDateLabel(day.date)}</strong>
                          <span>{day.isBookable ? `${day.maxBookings - day.bookedCount} spaces left` : "Unavailable"}</span>
                        </button>
                      ))}
                    </div>
                    <button className="primary" type="submit" disabled={saving || !rescheduleDate}>
                      {saving ? "Updating…" : "Update requested date"}
                    </button>
                  </form>
                ) : (
                  <div className="customer-booking-info-callout">
                    <strong>This booking is no longer editable here.</strong>
                    <p>
                      If you need to change anything now, please contact the shop directly so the workshop team can help.
                    </p>
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </section>
      </div>
    </PublicSiteLayout>
  );
};
