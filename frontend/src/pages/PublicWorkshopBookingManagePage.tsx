import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch } from "../api/client";

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

const getBookingStatusCopy = (status: string) => {
  switch (status) {
    case "BOOKING_MADE":
      return {
        label: "Request received",
        detail: "Your requested date is with the workshop team for confirmation.",
      };
    case "OPEN":
    case "BOOKED":
      return {
        label: "Booked",
        detail: "Your bike is booked in and the workshop will confirm the next step if timing changes.",
      };
    case "IN_PROGRESS":
      return {
        label: "In progress",
        detail: "Your bike is currently with the workshop.",
      };
    case "BIKE_READY":
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
  const { token } = useParams();
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
    () => getBookingStatusCopy(payload?.status ?? "BOOKING_MADE"),
    [payload?.status],
  );

  const canReschedule = payload?.status === "BOOKING_MADE";

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
    <div className="customer-booking-shell">
      <section className="customer-booking-card">
        <div className="customer-booking-hero">
          <div>
            <p className="customer-booking-kicker">Manage booking</p>
            <h1>Workshop booking details</h1>
            <p className="customer-booking-intro">
              Check the request details, see what happens next, and update the requested date if the booking has not
              been confirmed yet.
            </p>
          </div>
          <div className="customer-booking-hero-card">
            <strong>{statusCopy.label}</strong>
            <p>{statusCopy.detail}</p>
            {payload ? <p>{payload.bookingRequest.timingExpectation}</p> : null}
          </div>
        </div>

        <div className="customer-booking-topbar">
          <Link to="/site/workshop">Workshop information</Link>
          <Link to="/site/book-workshop">New booking request</Link>
        </div>

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
                  <span>Status</span>
                  <strong>{statusCopy.label}</strong>
                  <p>{statusCopy.detail}</p>
                </article>
                <article className="customer-booking-summary-card">
                  <span>Requested date</span>
                  <strong>{formatDateLabel(payload.scheduledDate)}</strong>
                  <p>{payload.bookingRequest.preferredTime || "Any time"}</p>
                </article>
                <article className="customer-booking-summary-card">
                  <span>Service</span>
                  <strong>{payload.bookingRequest.serviceLabel || "General workshop request"}</strong>
                  <p>{payload.bookingRequest.serviceRequest || "The workshop team will review the request details."}</p>
                </article>
                <article className="customer-booking-summary-card">
                  <span>Deposit</span>
                  <strong>
                    {payload.depositRequiredPence > 0 ? formatMoney(payload.depositRequiredPence) : "No deposit"}
                  </strong>
                  <p>
                    {payload.depositStatus === "PAID"
                      ? "Deposit received."
                      : "If a deposit is needed, the shop will confirm how to pay it."}
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
                  <p>The shop will review the request, confirm the timing if needed, and contact you with updates.</p>
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
  );
};
