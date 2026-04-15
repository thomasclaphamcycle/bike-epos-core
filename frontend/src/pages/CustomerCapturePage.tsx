import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getCustomerCapturePublicPageErrorMessage,
  getPublicCustomerCaptureStationEntry,
  getPublicSaleCustomerCaptureSession,
  submitPublicSaleCustomerCapture,
  type PublicCustomerCaptureSessionState,
  type PublicCustomerCaptureSubmitResponse,
} from "../features/customerCapture/customerCapture";

type CaptureFormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

const defaultFormState: CaptureFormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
};

const getFriendlySubmitError = (error: unknown) =>
  getCustomerCapturePublicPageErrorMessage(error) || "We could not save your details. Please try again.";

const getCaptureContextLabel = (ownerType: "sale" | "basket") => (
  ownerType === "sale" ? "sale" : "basket"
);

export const CustomerCapturePage = () => {
  const { token: routeToken, station: routeStation } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(
    () => routeToken?.trim() || searchParams.get("token")?.trim() || null,
    [routeToken, searchParams],
  );
  const station = useMemo(
    () => routeStation?.trim() || null,
    [routeStation],
  );
  const [session, setSession] = useState<PublicCustomerCaptureSessionState["session"] | null>(null);
  const [entryStation, setEntryStation] = useState<{
    key: string;
    entryPath: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<CaptureFormState>(defaultFormState);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PublicCustomerCaptureSubmitResponse | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!token) {
        if (station) {
          setLoading(true);
          setLoadError(null);
          setResult(null);
          setSubmitError(null);
          try {
            const payload = await getPublicCustomerCaptureStationEntry(station);
            if (!cancelled) {
              setEntryStation(payload.station);
              if (payload.session?.token) {
                navigate(`/customer-capture?token=${encodeURIComponent(payload.session.token)}`, {
                  replace: true,
                });
                return;
              }
              setSession(null);
            }
          } catch (error) {
            if (!cancelled) {
              setEntryStation(null);
              setSession(null);
              setLoadError(getCustomerCapturePublicPageErrorMessage(error));
            }
          } finally {
            if (!cancelled) {
              setLoading(false);
            }
          }
          return;
        }

        setLoading(false);
        setSession(null);
        setEntryStation(null);
        setLoadError(null);
        setResult(null);
        return;
      }

      setLoading(true);
      setEntryStation(null);
      setLoadError(null);
      setResult(null);
      setSubmitError(null);
      try {
        const payload = await getPublicSaleCustomerCaptureSession(token);
        if (!cancelled) {
          setSession(payload.session);
        }
      } catch (error) {
        if (!cancelled) {
          setSession(null);
          setLoadError(getCustomerCapturePublicPageErrorMessage(error));
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
  }, [navigate, reloadNonce, station, token]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      return;
    }

    if (!form.firstName.trim() || !form.lastName.trim() || (!form.email.trim() && !form.phone.trim())) {
      setSubmitError("Enter first name, last name, and at least one contact method.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = await submitPublicSaleCustomerCapture(token, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      });
      setResult(payload);
      setSession(payload.session);
    } catch (error) {
      setSubmitError(getFriendlySubmitError(error));
      try {
        const payload = await getPublicSaleCustomerCaptureSession(token);
        setSession(payload.session);
      } catch {
        // Keep the friendly submit error already shown.
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isActive = session?.status === "ACTIVE" && !result;
  const isReplaced = session?.status === "EXPIRED" && session.isReplaced;
  const isWaitingForEntrySession = !token;
  const contextLabel = getCaptureContextLabel(result?.session.ownerType ?? session?.ownerType ?? "sale");
  const startedAtLabel = session?.createdAt
    ? new Date(session.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const expiresAtLabel = session?.expiresAt
    ? new Date(session.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="page-shell customer-capture-shell">
      <section className="card customer-capture-card">
        <div className="customer-capture-heading">
          <span className="status-badge status-complete">
            {isWaitingForEntrySession ? "Customer capture tap point" : "Tap opened a secure customer form"}
          </span>
          <h1>{isWaitingForEntrySession ? "Share your details when staff starts the request" : `Share your details for this ${contextLabel}`}</h1>
          <p className="muted-text">
            {isWaitingForEntrySession
              ? "Staff will start a live tap request on the till when they are ready for your details."
              : `This takes under a minute. Enter your name and at least one contact method so staff can attach it to today&apos;s ${contextLabel}.`}
          </p>
        </div>

        {loading ? <p>Loading link...</p> : null}

        {!loading && !token && !loadError ? (
          <div
            className="quick-create-panel customer-capture-state-card"
            data-testid={station ? "customer-capture-entry-waiting" : "customer-capture-no-token"}
          >
            <strong>{station ? "Waiting for a live tap request" : "No active customer capture yet"}</strong>
            <p className="muted-text">
              Ask staff to start a new tap request on the till, then tap your phone again.
            </p>
            {entryStation ? (
              <p className="muted-text">
                Tap point: {entryStation.key}
              </p>
            ) : null}
          </div>
        ) : null}

        {!loading && loadError ? (
          <div className="quick-create-panel customer-capture-state-card">
            <strong>Link unavailable</strong>
            <p className="muted-text">{loadError}</p>
            <div className="actions-inline">
              <button type="button" onClick={() => setReloadNonce((current) => current + 1)}>
                Try again
              </button>
            </div>
          </div>
        ) : null}

        {!loading && !loadError && result ? (
          <div className="success-panel success-panel-sale" data-testid="customer-capture-success">
            <div className="success-panel-heading">
              <strong>Details saved.</strong>
              <span className="status-badge status-complete">Attached to {contextLabel}</span>
            </div>
            <p>
              Thanks {result.customer.firstName}. Your details have been linked to the {contextLabel}.
            </p>
            <p className="muted-text">
              {result.matchType === "created"
                ? "A new customer profile was created."
                : `Your details matched an existing customer by ${result.matchType}.`}
            </p>
          </div>
        ) : null}

        {!loading && !loadError && session?.status === "COMPLETED" && !result ? (
          <div className="quick-create-panel customer-capture-state-card">
            <strong>Details already submitted</strong>
            <p className="muted-text">
              This customer capture link has already been completed and staff should now see the attached customer back on the till.
            </p>
            <p className="muted-text">
              If anything still looks wrong, ask staff to start a fresh tap request rather than reusing this page.
            </p>
          </div>
        ) : null}

        {!loading && !loadError && isReplaced ? (
          <div className="quick-create-panel customer-capture-state-card">
            <strong>Link replaced</strong>
            <p className="muted-text">
              Staff have already generated a newer customer capture link, so this older one is no longer active.
            </p>
            <p className="muted-text">
              Please use the newest tap request instead.
            </p>
          </div>
        ) : null}

        {!loading && !loadError && session?.status === "EXPIRED" && !isReplaced ? (
          <div className="quick-create-panel customer-capture-state-card">
            <strong>Link expired</strong>
            <p className="muted-text">
              This customer capture link expired before it was used.
            </p>
            <p className="muted-text">
              Please ask staff for a fresh tap request and try again.
            </p>
          </div>
        ) : null}

        {isActive ? (
          <form className="customer-capture-form" onSubmit={handleSubmit} data-testid="customer-capture-form">
            <div className="quick-create-panel customer-capture-state-card customer-capture-active-note">
              <strong>Check your details, then submit</strong>
              <p className="muted-text">
                The shop will use this to identify you quickly and attach the right customer record.
              </p>
              <div className="customer-capture-meta">
                <span>Started {startedAtLabel || "just now"}</span>
                <span>Expires {expiresAtLabel || "soon"}</span>
              </div>
            </div>

            <div className="customer-capture-grid">
              <label>
                First name
                <input
                  data-testid="customer-capture-first-name"
                  value={form.firstName}
                  onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
                  autoComplete="given-name"
                  placeholder="Alex"
                  autoFocus
                  disabled={submitting}
                  required
                />
              </label>
              <label>
                Last name
                <input
                  data-testid="customer-capture-last-name"
                  value={form.lastName}
                  onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
                  autoComplete="family-name"
                  placeholder="Taylor"
                  disabled={submitting}
                  required
                />
              </label>
              <label>
                Email
                <input
                  data-testid="customer-capture-email"
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  autoComplete="email"
                  placeholder="name@example.com"
                  disabled={submitting}
                />
              </label>
              <label>
                Phone
                <input
                  data-testid="customer-capture-phone"
                  value={form.phone}
                  onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="07..."
                  disabled={submitting}
                />
              </label>
            </div>

            <p className="muted-text">
              Enter your first and last name, plus either email or phone. Accurate details make checkout and follow-up faster.
            </p>

            {submitError ? <p className="customer-capture-error">{submitError}</p> : null}

            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? "Saving details..." : "Save details"}
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
};
