import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";

type PublicCaptureSessionState = {
  session: {
    status: "ACTIVE" | "COMPLETED" | "EXPIRED";
    expiresAt: string;
    completedAt: string | null;
  };
};

type PublicCaptureSubmitResponse = {
  session: {
    status: "COMPLETED";
    expiresAt: string;
    completedAt: string | null;
  };
  customer: {
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };
  sale: {
    id: string;
  };
  matchType: "email" | "phone" | "created";
};

const defaultForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  emailMarketingConsent: false,
  smsMarketingConsent: false,
};

export const CustomerCapturePage = () => {
  const { token } = useParams();
  const [session, setSession] = useState<PublicCaptureSessionState["session"] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [result, setResult] = useState<PublicCaptureSubmitResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!token) {
        setLoadError("This customer capture link is invalid.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);
      try {
        const payload = await apiGet<PublicCaptureSessionState>(
          `/api/public/customer-capture/${encodeURIComponent(token)}`,
        );
        if (!cancelled) {
          setSession(payload.session);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Failed to load customer capture link.");
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      return;
    }

    setSubmitting(true);
    setLoadError(null);
    try {
      const payload = await apiPost<PublicCaptureSubmitResponse>(
        `/api/public/customer-capture/${encodeURIComponent(token)}`,
        {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email || undefined,
          phone: form.phone || undefined,
          emailMarketingConsent: form.emailMarketingConsent,
          smsMarketingConsent: form.smsMarketingConsent,
        },
      );
      setResult(payload);
      setSession(payload.session);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to save your details.");
    } finally {
      setSubmitting(false);
    }
  };

  const isActive = session?.status === "ACTIVE" && !result;

  return (
    <div className="page-shell cash-upload-shell">
      <section className="card cash-upload-card customer-capture-card">
        <div className="cash-upload-heading">
          <span className="status-badge">{session?.status ?? "Customer capture"}</span>
          <h1>Share your contact details</h1>
          <p className="muted-text">
            Add your contact details to this sale so the shop can attach them to today&apos;s checkout.
          </p>
        </div>

        {loading ? <p>Loading link...</p> : null}

        {!loading && loadError ? (
          <div className="quick-create-panel">
            <strong>Link unavailable</strong>
            <p className="muted-text">{loadError}</p>
            <Link to="/login">Back to CorePOS</Link>
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
              Match result: {result.matchType === "created" ? "new customer created" : `matched by ${result.matchType}`}.
            </p>
          </div>
        ) : null}

        {!loading && !loadError && session?.status === "COMPLETED" && !result ? (
          <div className="quick-create-panel">
            <strong>Link already used</strong>
            <p className="muted-text">This customer capture link has already been completed.</p>
          </div>
        ) : null}

        {!loading && !loadError && session?.status === "EXPIRED" ? (
          <div className="quick-create-panel">
            <strong>Link expired</strong>
            <p className="muted-text">This customer capture link has expired. Please ask staff for a fresh link.</p>
          </div>
        ) : null}

        {isActive ? (
          <form className="cash-upload-form" onSubmit={handleSubmit} data-testid="customer-capture-form">
            <div className="quick-create-grid customer-capture-grid">
              <label>
                First name
                <input
                  data-testid="customer-capture-first-name"
                  value={form.firstName}
                  onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
                  required
                />
              </label>
              <label>
                Last name
                <input
                  data-testid="customer-capture-last-name"
                  value={form.lastName}
                  onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
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
                  placeholder="name@example.com"
                />
              </label>
              <label>
                Phone
                <input
                  data-testid="customer-capture-phone"
                  value={form.phone}
                  onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="Phone number"
                />
              </label>
            </div>

            <p className="muted-text">Enter at least one contact method: email or phone.</p>

            <label className="customer-capture-checkbox">
              <input
                type="checkbox"
                checked={form.emailMarketingConsent}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  emailMarketingConsent: event.target.checked,
                }))}
              />
              <span>Email me about offers and updates</span>
            </label>

            <label className="customer-capture-checkbox">
              <input
                type="checkbox"
                checked={form.smsMarketingConsent}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  smsMarketingConsent: event.target.checked,
                }))}
              />
              <span>Text me about offers and updates</span>
            </label>

            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? "Saving..." : "Save details"}
            </button>

            <p className="muted-text">
              This link expires at {new Date(session.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
            </p>
          </form>
        ) : null}
      </section>
    </div>
  );
};
