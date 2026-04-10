import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  getCustomerCapturePublicPageErrorMessage,
  getPublicSaleCustomerCaptureSession,
  submitPublicSaleCustomerCapture,
  type PublicSaleCustomerCaptureSessionState,
  type PublicSaleCustomerCaptureSubmitResponse,
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

export const CustomerCapturePage = () => {
  const { token: routeToken } = useParams();
  const [searchParams] = useSearchParams();
  const token = useMemo(
    () => routeToken?.trim() || searchParams.get("token")?.trim() || null,
    [routeToken, searchParams],
  );
  const [session, setSession] = useState<PublicSaleCustomerCaptureSessionState["session"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<CaptureFormState>(defaultFormState);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PublicSaleCustomerCaptureSubmitResponse | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!token) {
        setLoading(false);
        setSession(null);
        setLoadError(null);
        setResult(null);
        return;
      }

      setLoading(true);
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
  }, [token, reloadNonce]);

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

  return (
    <div className="page-shell customer-capture-shell">
      <section className="card customer-capture-card">
        <div className="customer-capture-heading">
          <span className="status-badge">Customer capture</span>
          <h1>Share your contact details</h1>
          <p className="muted-text">
            Add your details to this sale so the shop can attach them to today&apos;s checkout quickly and accurately.
          </p>
        </div>

        {loading ? <p>Loading link...</p> : null}

        {!loading && !token ? (
          <div className="quick-create-panel">
            <strong>No active customer capture yet</strong>
            <p className="muted-text">Ask staff to start Add Customer on the till, then scan the QR code or open the link again.</p>
          </div>
        ) : null}

        {!loading && loadError ? (
          <div className="quick-create-panel">
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
              <span className="status-badge status-complete">Attached to sale</span>
            </div>
            <p>
              Thanks {result.customer.firstName}. Your details have been linked to the sale.
            </p>
            <p className="muted-text">
              {result.matchType === "created"
                ? "A new customer profile was created."
                : `Your details matched an existing customer by ${result.matchType}.`}
            </p>
          </div>
        ) : null}

        {!loading && !loadError && session?.status === "COMPLETED" && !result ? (
          <div className="quick-create-panel">
            <strong>Link already used</strong>
            <p className="muted-text">
              This customer capture link has already been completed. If staff still need your details, please ask them for a fresh link.
            </p>
          </div>
        ) : null}

        {!loading && !loadError && isReplaced ? (
          <div className="quick-create-panel">
            <strong>Link replaced</strong>
            <p className="muted-text">
              Staff have already generated a newer customer capture link for this sale. Please scan the latest QR code or ask them to reopen the newest link.
            </p>
          </div>
        ) : null}

        {!loading && !loadError && session?.status === "EXPIRED" && !isReplaced ? (
          <div className="quick-create-panel">
            <strong>Link expired</strong>
            <p className="muted-text">
              This customer capture link has expired. Please ask staff for a fresh link and try again.
            </p>
          </div>
        ) : null}

        {isActive ? (
          <form className="customer-capture-form" onSubmit={handleSubmit} data-testid="customer-capture-form">
            <div className="customer-capture-grid">
              <label>
                First name
                <input
                  data-testid="customer-capture-first-name"
                  value={form.firstName}
                  onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
                  autoComplete="given-name"
                  placeholder="Alex"
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
              Enter first and last name, plus at least one contact method. Short accurate details work best for fast checkout follow-up.
            </p>

            {submitError ? <p className="customer-capture-error">{submitError}</p> : null}

            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? "Saving details..." : "Save details"}
            </button>

            <p className="muted-text">
              Started {new Date(session.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
              {" "}
              This link expires at {new Date(session.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
            </p>
          </form>
        ) : null}
      </section>
    </div>
  );
};
