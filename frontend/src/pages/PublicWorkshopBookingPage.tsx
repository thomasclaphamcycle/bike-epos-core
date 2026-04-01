import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { PublicSiteLayout } from "../components/PublicSiteLayout";
import {
  customerBookingSteps,
  publicSitePaths,
  secureCustomerTouchpoints,
} from "../features/publicSite/siteContent";

type PublicWorkshopBookingMeta = {
  config: {
    store: {
      name: string;
      businessName: string;
      email: string;
      phone: string;
      openingHours: Record<
        "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY",
        {
          isClosed: boolean;
          opensAt: string;
          closesAt: string;
        }
      >;
    };
    workshop: {
      defaultDepositPence: number;
    };
  };
  booking: {
    minBookableDate: string;
    maxBookingsPerDay: number;
    defaultDepositPence: number;
    timingMode: "REQUESTED_DATE";
    timingMessage: string;
  };
  serviceOptions: Array<{
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    defaultDurationMinutes: number | null;
  }>;
};

type WorkshopAvailabilityDay = {
  date: string;
  bookedCount: number;
  maxBookings: number;
  isBookable: boolean;
};

type CreateBookingResponse = {
  manageToken: string;
};

const formatDateLabel = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const PREFERRED_TIME_OPTIONS = [
  { value: "MORNING", label: "Morning drop-off" },
  { value: "AFTERNOON", label: "Afternoon drop-off" },
  { value: "ANYTIME", label: "Any time" },
];

const BOOKING_PREP_CARDS = [
  {
    title: "What to tell us",
    detail:
      "Pick the closest service type if it helps, then describe the bike and the real issue in your own words.",
  },
  {
    title: "What happens after you send",
    detail:
      "Your chosen date is a request. The workshop reviews it, confirms the practical timing, and keeps that next step visible on the secure link.",
  },
  secureCustomerTouchpoints[1],
];

export const PublicWorkshopBookingPage = () => {
  const navigate = useNavigate();
  const [meta, setMeta] = useState<PublicWorkshopBookingMeta | null>(null);
  const [availability, setAvailability] = useState<WorkshopAvailabilityDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    bikeDescription: "",
    serviceTemplateId: "",
    serviceRequest: "",
    preferredTime: "ANYTIME",
    scheduledDate: "",
    notes: "",
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const formMeta = await apiGet<PublicWorkshopBookingMeta>("/api/workshop-bookings/public-form");
        if (cancelled) {
          return;
        }
        setMeta(formMeta);

        const start = formMeta.booking.minBookableDate.slice(0, 10);
        const startDate = new Date(`${start}T00:00:00.000Z`);
        const endDate = new Date(startDate);
        endDate.setUTCDate(endDate.getUTCDate() + 20);
        const end = endDate.toISOString().slice(0, 10);
        const availabilityPayload = await apiGet<WorkshopAvailabilityDay[]>(
          `/api/workshop/availability?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`,
        );

        if (cancelled) {
          return;
        }

        setAvailability(availabilityPayload);
        const firstBookable = availabilityPayload.find((day) => day.isBookable)?.date ?? "";
        setForm((current) => ({
          ...current,
          scheduledDate: current.scheduledDate || firstBookable,
        }));
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load workshop booking.");
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
  }, []);

  const selectedService = useMemo(
    () =>
      meta?.serviceOptions.find((option) => option.id === form.serviceTemplateId) ?? null,
    [meta, form.serviceTemplateId],
  );

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const booking = await apiPost<CreateBookingResponse>("/api/workshop-bookings", {
        ...form,
        serviceTemplateId: form.serviceTemplateId || undefined,
        email: form.email || undefined,
        notes: form.notes || undefined,
        bikeDescription: form.bikeDescription || undefined,
        serviceRequest: form.serviceRequest || undefined,
      });

      navigate(`${publicSitePaths.bookingManage(booking.manageToken)}?created=1`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not send workshop booking.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicSiteLayout currentNav="repairs">
      <div className="customer-booking-shell">
        <nav className="public-site-breadcrumbs" aria-label="Booking breadcrumbs">
          <Link to={publicSitePaths.home}>Overview</Link>
          <span>/</span>
          <Link to={publicSitePaths.repairs}>Repairs</Link>
          <span>/</span>
          <span>Book workshop</span>
        </nav>

        <section className="customer-booking-card">
          <div className="customer-booking-hero">
            <div>
              <p className="customer-booking-kicker">Workshop booking</p>
              <h1>Tell us about the bike before you visit</h1>
              <p className="customer-booking-intro">
                This request starts the secure customer journey. Share the bike, the issue, and the day that would
                suit you best, and the workshop will confirm the practical timing after review.
              </p>
            </div>
            <div className="customer-booking-hero-card">
              <strong>{meta?.config.store.businessName || meta?.config.store.name || "CorePOS Bikes"}</strong>
              <p>{meta?.booking.timingMessage || "Choose a preferred date and we will confirm the final timing."}</p>
              <p>
                {meta
                  ? `Typical booking deposit: ${formatMoney(meta.booking.defaultDepositPence)}`
                  : "Deposit details will be confirmed if needed."}
              </p>
              <p>You will receive a secure manage link as soon as this request is sent.</p>
            </div>
          </div>

          <div className="customer-booking-topbar">
            <Link to={publicSitePaths.repairs}>Repair journey</Link>
            <Link to={publicSitePaths.services}>Workshop services</Link>
            <Link to={publicSitePaths.contact}>Contact the shop</Link>
          </div>

          <section className="customer-booking-journey" data-testid="customer-booking-journey">
            {customerBookingSteps.map((step, index) => (
              <article key={step.title} className="customer-booking-journey-step">
                <span className="customer-booking-journey-number">{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.detail}</p>
                </div>
              </article>
            ))}
          </section>

          <section className="customer-booking-prep-grid">
            {BOOKING_PREP_CARDS.map((card) => (
              <article key={card.title} className="customer-booking-prep-card">
                <strong>{card.title}</strong>
                <p>{card.detail}</p>
              </article>
            ))}
          </section>

          {loading ? <p>Loading workshop booking details…</p> : null}
          {error ? <p className="error-text">{error}</p> : null}

          {!loading && meta ? (
            <form className="customer-booking-form" onSubmit={handleSubmit}>
              <section className="customer-booking-section">
                <div className="customer-booking-section-header">
                  <div>
                    <h2>Service and issue</h2>
                    <p>Pick the closest service type if it helps, then tell us what the bike needs.</p>
                  </div>
                </div>

                {meta.serviceOptions.length > 0 ? (
                  <div className="customer-booking-service-grid">
                    {meta.serviceOptions.map((option) => {
                      const active = form.serviceTemplateId === option.id;
                      return (
                        <label
                          key={option.id}
                          className={active ? "customer-booking-service-card customer-booking-service-card--active" : "customer-booking-service-card"}
                        >
                          <input
                            type="radio"
                            name="serviceTemplateId"
                            value={option.id}
                            checked={active}
                            onChange={(event) => handleChange("serviceTemplateId", event.target.value)}
                          />
                          <span>
                            <strong>{option.name}</strong>
                            {option.category ? <span>{option.category}</span> : null}
                            {option.description ? <small>{option.description}</small> : null}
                            {option.defaultDurationMinutes ? (
                              <small>Typical workshop time: {option.defaultDurationMinutes} minutes</small>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}

                <label className="customer-booking-field customer-booking-field--full">
                  <span>What would you like us to do?</span>
                  <textarea
                    rows={4}
                    value={form.serviceRequest}
                    onChange={(event) => handleChange("serviceRequest", event.target.value)}
                    placeholder="Example: Brake rub and gears slipping under load."
                  />
                </label>
              </section>

              <section className="customer-booking-section">
                <div className="customer-booking-section-header">
                  <div>
                    <h2>Bike details</h2>
                    <p>Give us enough detail to recognise the bike at drop-off.</p>
                  </div>
                </div>

                <label className="customer-booking-field customer-booking-field--full">
                  <span>Bike description</span>
                  <input
                    value={form.bikeDescription}
                    onChange={(event) => handleChange("bikeDescription", event.target.value)}
                    placeholder="Example: Trek Domane AL 2, blue, medium frame"
                  />
                </label>
              </section>

              <section className="customer-booking-section">
                <div className="customer-booking-section-header">
                  <div>
                    <h2>Date and timing</h2>
                    <p>This is a request, not a confirmed mechanic slot. We will confirm the final drop-off timing.</p>
                  </div>
                </div>

                <div className="customer-booking-date-grid">
                  {availability.map((day) => (
                    <button
                      key={day.date}
                      type="button"
                      className={
                        form.scheduledDate === day.date
                          ? "customer-booking-date-pill customer-booking-date-pill--selected"
                          : "customer-booking-date-pill"
                      }
                      onClick={() => handleChange("scheduledDate", day.date)}
                      disabled={!day.isBookable}
                    >
                      <strong>{formatDateLabel(day.date)}</strong>
                      <span>{day.isBookable ? `${day.maxBookings - day.bookedCount} spaces left` : "Unavailable"}</span>
                    </button>
                  ))}
                </div>

                <div className="customer-booking-preferred-time">
                  {PREFERRED_TIME_OPTIONS.map((option) => (
                    <label key={option.value} className="customer-booking-chip">
                      <input
                        type="radio"
                        name="preferredTime"
                        value={option.value}
                        checked={form.preferredTime === option.value}
                        onChange={(event) => handleChange("preferredTime", event.target.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="customer-booking-section">
                <div className="customer-booking-section-header">
                  <div>
                    <h2>Your details</h2>
                    <p>We use these details to confirm the booking and send workshop updates.</p>
                  </div>
                </div>

                <div className="customer-booking-grid">
                  <label className="customer-booking-field">
                    <span>First name</span>
                    <input
                      required
                      value={form.firstName}
                      onChange={(event) => handleChange("firstName", event.target.value)}
                    />
                  </label>
                  <label className="customer-booking-field">
                    <span>Last name</span>
                    <input
                      required
                      value={form.lastName}
                      onChange={(event) => handleChange("lastName", event.target.value)}
                    />
                  </label>
                  <label className="customer-booking-field">
                    <span>Phone</span>
                    <input
                      required
                      value={form.phone}
                      onChange={(event) => handleChange("phone", event.target.value)}
                    />
                  </label>
                  <label className="customer-booking-field">
                    <span>Email</span>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(event) => handleChange("email", event.target.value)}
                    />
                  </label>
                </div>

                <label className="customer-booking-field customer-booking-field--full">
                  <span>Anything else we should know?</span>
                  <textarea
                    rows={3}
                    value={form.notes}
                    onChange={(event) => handleChange("notes", event.target.value)}
                    placeholder="Example: Please phone before replacing any parts."
                  />
                </label>
              </section>

              <aside className="customer-booking-summary">
                <h2>Booking summary</h2>
                <dl>
                  <div>
                    <dt>Service</dt>
                    <dd>{selectedService?.name || "General workshop request"}</dd>
                  </div>
                  <div>
                    <dt>Requested date</dt>
                    <dd>{form.scheduledDate ? formatDateLabel(form.scheduledDate) : "Choose a date"}</dd>
                  </div>
                  <div>
                    <dt>Preferred timing</dt>
                    <dd>{PREFERRED_TIME_OPTIONS.find((option) => option.value === form.preferredTime)?.label || "Any time"}</dd>
                  </div>
                  <div>
                    <dt>Secure follow-up</dt>
                    <dd>You will get a secure manage link as soon as the request is sent.</dd>
                  </div>
                  <div>
                    <dt>What happens next</dt>
                    <dd>The workshop reviews this request, confirms timing, and sends updates if approval or collection details are needed.</dd>
                  </div>
                </dl>
                <div className="customer-booking-info-callout">
                  <strong>This page starts the customer journey.</strong>
                  <p>
                    Quotes, workshop updates, and ready-to-collect messages stay tied to the secure follow-up flow so
                    you always know the next step.
                  </p>
                </div>
                <button className="primary" type="submit" disabled={submitting || !form.scheduledDate}>
                  {submitting ? "Sending request…" : "Send booking request"}
                </button>
              </aside>
            </form>
          ) : null}
        </section>
      </div>
    </PublicSiteLayout>
  );
};
