import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiPost } from "../api/client";
import { PublicSiteLayout } from "../components/PublicSiteLayout";
import { useCustomerAccount } from "../customerAccount/CustomerAccountContext";
import {
  publicSitePaths,
  secureCustomerTouchpoints,
} from "../features/publicSite/siteContent";

type RequestLinkResponse = {
  ok: boolean;
  message: string;
  devMagicLinkUrl?: string;
};

const ACCESS_BENEFITS = [
  {
    title: "Keep workshop jobs in one place",
    detail: "See active bookings, approvals, progress updates, and collection readiness without hunting through old messages.",
  },
  {
    title: "Reconnect from secure email links",
    detail: "Existing workshop links still work. Your account simply becomes the persistent place to return to between visits.",
  },
  secureCustomerTouchpoints[2],
];

export const CustomerAccountLoginPage = () => {
  const { session } = useCustomerAccount();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [devMagicLinkUrl, setDevMagicLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!email && session.authenticated && session.account?.email) {
      setEmail(session.account.email);
    }
  }, [email, session.account?.email, session.authenticated]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    setDevMagicLinkUrl(null);

    try {
      const payload = await apiPost<RequestLinkResponse>("/api/customer-auth/request-link", {
        email,
        returnTo: searchParams.get("returnTo") ?? undefined,
      });
      setMessage(payload.message);
      setDevMagicLinkUrl(payload.devMagicLinkUrl ?? null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not request a secure customer access link.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicSiteLayout currentNav="repairs">
      <div className="customer-booking-shell">
        <nav className="public-site-breadcrumbs" aria-label="Customer access breadcrumbs">
          <Link to={publicSitePaths.home}>Overview</Link>
          <span>/</span>
          <span>Customer access</span>
        </nav>

        <section className="customer-booking-card customer-account-card">
          <div className="customer-booking-hero">
            <div>
              <p className="customer-booking-kicker">Customer account</p>
              <h1>Secure access for your workshop journey</h1>
              <p className="customer-booking-intro">
                Phase 1 keeps your active bookings, approvals, bike context, and collection-ready updates
                together. Sign-in stays passwordless: we send a secure link to the same email address you use
                with the workshop.
              </p>
            </div>
            <div className="customer-booking-hero-card">
              <strong>Passwordless access</strong>
              <p>The link expires quickly and signs you in on this device only.</p>
              <p>Existing secure booking and quote links still stay valid while the account layer settles in.</p>
            </div>
          </div>

          <section className="customer-booking-prep-grid">
            {ACCESS_BENEFITS.map((card) => (
              <article key={card.title} className="customer-booking-prep-card">
                <strong>{card.title}</strong>
                <p>{card.detail}</p>
              </article>
            ))}
          </section>

          {session.authenticated ? (
            <div className="customer-account-inline-banner">
              <strong>{session.customer?.displayName || "You are already signed in."}</strong>
              <p>Your workshop account is active on this device.</p>
              <Link className="button-link" to={publicSitePaths.account}>
                Open customer account
              </Link>
            </div>
          ) : null}

          <section className="customer-booking-section">
            <div className="customer-booking-section-header">
              <div>
                <h2>Request a secure sign-in link</h2>
                <p>Use the same email address you have already used with the workshop.</p>
              </div>
            </div>

            {message ? <p className="success-text">{message}</p> : null}
            {error ? <p className="error-text">{error}</p> : null}

            <form className="customer-booking-form customer-account-form" onSubmit={handleSubmit}>
              <div className="customer-booking-grid">
                <label className="customer-booking-field customer-booking-field--full">
                  <span>Email address</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />
                </label>
              </div>

              <div className="customer-account-actions">
                <button type="submit" className="button-link" disabled={submitting}>
                  {submitting ? "Sending secure link..." : "Send secure sign-in link"}
                </button>
                <Link to={publicSitePaths.bookWorkshop}>Need to start a new repair instead?</Link>
              </div>
            </form>

            {devMagicLinkUrl ? (
              <div className="customer-account-dev-preview">
                <strong>Development preview</strong>
                <p>Non-production mode exposes the link here so the flow can be tested without an inbox.</p>
                <a href={devMagicLinkUrl}>{devMagicLinkUrl}</a>
              </div>
            ) : null}
          </section>
        </section>
      </div>
    </PublicSiteLayout>
  );
};
