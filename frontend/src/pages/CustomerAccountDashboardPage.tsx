import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError, apiGet } from "../api/client";
import { PublicSiteLayout } from "../components/PublicSiteLayout";
import { useCustomerAccount } from "../customerAccount/CustomerAccountContext";
import { publicSitePaths } from "../features/publicSite/siteContent";

type CustomerAccountDashboard = {
  account: {
    id: string;
    email: string;
    status: "ACTIVE" | "DISABLED";
    createdAt: string;
    lastAccessLinkSentAt: string | null;
    lastLoginAt: string | null;
  };
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    createdAt: string;
  };
  spotlight: {
    nextAction: {
      kind: "APPROVAL_NEEDED" | "READY_TO_COLLECT" | "IN_PROGRESS";
      title: string;
      detail: string;
      path: string;
      actionLabel: string;
    } | null;
    counts: {
      activeJobs: number;
      awaitingApproval: number;
      readyToCollect: number;
      bikes: number;
    };
  };
  activeJobs: Array<{
    id: string;
    executionStatus: "BOOKED" | "IN_PROGRESS" | "READY" | "COLLECTED" | "CLOSED";
    statusLabel: string;
    bikeId: string | null;
    bikeDisplayName: string;
    scheduledDate: string | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    durationMinutes: number | null;
    createdAt: string;
    updatedAt: string;
    customerProgress: {
      stage: string;
      label: string;
      headline: string;
      detail: string;
      nextStep: string;
      needsCustomerAction: boolean;
    };
    collection: {
      state: string;
      headline: string;
      detail: string;
      nextStep: string;
      totalPence: number | null;
      outstandingPence: number | null;
      paidPence: number;
      depositPaidPence: number;
      depositRequiredPence: number;
      depositStatus: "NOT_REQUIRED" | "REQUIRED" | "PAID";
    };
    estimate: {
      id: string;
      version: number;
      status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "SUPERSEDED";
      subtotalPence: number;
      labourTotalPence: number;
      partsTotalPence: number;
      lineCount: number;
      requestedAt: string | null;
      approvedAt: string | null;
      rejectedAt: string | null;
    } | null;
    conversation: {
      updatedAt: string;
      messageCount: number;
      latestMessage: {
        bodyPreview: string;
        createdAt: string;
        direction: "OUTBOUND" | "INBOUND";
        channel: "PORTAL" | "EMAIL" | "SMS" | "WHATSAPP" | "INTERNAL_SYSTEM";
      } | null;
    } | null;
    workSummary: {
      headline: string;
      lineCount: number;
    };
    links: {
      quotePath: string | null;
      managePath: string | null;
      primaryPath: string | null;
    };
  }>;
  bikes: Array<{
    id: string;
    displayName: string;
    activeJobCount: number;
    latestServiceAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  recentHistory: Array<{
    id: string;
    bikeDisplayName: string;
    statusLabel: string;
    completedAt: string;
    totalPence: number | null;
    summary: string;
  }>;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatOptionalDate = (value: string | null | undefined) => {
  if (!value) {
    return "To be confirmed";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB", {
    dateStyle: "medium",
  });
};

const formatOptionalDateTime = (value: string | null | undefined) => {
  if (!value) {
    return "To be confirmed";
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

export const CustomerAccountDashboardPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isLoading: sessionLoading, logout, session } = useCustomerAccount();
  const [dashboard, setDashboard] = useState<CustomerAccountDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionLoading && !session.authenticated) {
      navigate(
        `${publicSitePaths.accountLogin}?returnTo=${encodeURIComponent(location.pathname + location.search)}`,
        { replace: true },
      );
    }
  }, [location.pathname, location.search, navigate, session.authenticated, sessionLoading]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!session.authenticated) {
        setLoading(false);
        return;
      }

      try {
        const payload = await apiGet<CustomerAccountDashboard>("/api/customer-account/dashboard");
        if (!cancelled) {
          setDashboard(payload);
        }
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        if (loadError instanceof ApiError && loadError.status === 401) {
          navigate(
            `${publicSitePaths.accountLogin}?returnTo=${encodeURIComponent(location.pathname + location.search)}`,
            { replace: true },
          );
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "Could not load your customer account.");
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
  }, [location.pathname, location.search, navigate, session.authenticated]);

  const summaryCards = useMemo(
    () =>
      dashboard
        ? [
            {
              label: "Active workshop jobs",
              value: dashboard.spotlight.counts.activeJobs,
              detail: "Current bookings, repairs, or collection-ready bikes.",
            },
            {
              label: "Awaiting your approval",
              value: dashboard.spotlight.counts.awaitingApproval,
              detail: "Jobs that cannot continue until you decide.",
            },
            {
              label: "Ready to collect",
              value: dashboard.spotlight.counts.readyToCollect,
              detail: "Bikes the workshop has marked ready or nearly ready for handover.",
            },
            {
              label: "Bikes linked",
              value: dashboard.spotlight.counts.bikes,
              detail: "Known bikes on this customer relationship so far.",
            },
          ]
        : [],
    [dashboard],
  );

  if (sessionLoading || loading) {
    return (
      <PublicSiteLayout currentNav="repairs">
        <div className="customer-booking-shell">
          <section className="customer-booking-card customer-account-card">
            <p>Loading your customer account…</p>
          </section>
        </div>
      </PublicSiteLayout>
    );
  }

  if (!session.authenticated) {
    return (
      <PublicSiteLayout currentNav="repairs">
        <div className="customer-booking-shell">
          <section className="customer-booking-card customer-account-card">
            <p>Redirecting to secure customer sign-in…</p>
          </section>
        </div>
      </PublicSiteLayout>
    );
  }

  return (
    <PublicSiteLayout currentNav="repairs">
      <div className="customer-booking-shell">
        <nav className="public-site-breadcrumbs" aria-label="Customer account breadcrumbs">
          <Link to={publicSitePaths.home}>Overview</Link>
          <span>/</span>
          <span>Customer account</span>
        </nav>

        <section className="customer-booking-card customer-account-card">
          <div className="customer-booking-hero">
            <div>
              <p className="customer-booking-kicker">Customer account</p>
              <h1>{dashboard?.customer.displayName || session.customer?.displayName || "Your workshop account"}</h1>
              <p className="customer-booking-intro">
                This is the persistent workshop-first customer layer. Your active jobs, saved bikes, approvals,
                and collection readiness now stay easier to revisit between secure links and repeat visits.
              </p>
            </div>
            <div className="customer-booking-hero-card">
              <strong>{dashboard?.account.email || session.account?.email || "Signed in"}</strong>
              <p>
                Last sign-in{" "}
                {formatOptionalDateTime(dashboard?.account.lastLoginAt || session.account?.lastLoginAt || null)}
              </p>
              <p>Workshop bookings still keep their existing secure links, and they also surface here now.</p>
            </div>
          </div>

          <div className="customer-booking-topbar">
            <Link to={publicSitePaths.bookWorkshop}>Book another workshop visit</Link>
            <Link to={publicSitePaths.repairs}>Repair journey</Link>
            <button type="button" className="public-site-logout-button" onClick={() => void logout()}>
              Sign out
            </button>
          </div>

          {error ? <p className="error-text">{error}</p> : null}

          {dashboard?.spotlight.nextAction ? (
            <section className="customer-account-next-action">
              <div>
                <p className="customer-booking-kicker">Next action</p>
                <h2>{dashboard.spotlight.nextAction.title}</h2>
                <p>{dashboard.spotlight.nextAction.detail}</p>
              </div>
              <Link className="button-link" to={dashboard.spotlight.nextAction.path}>
                {dashboard.spotlight.nextAction.actionLabel}
              </Link>
            </section>
          ) : null}

          <section className="customer-booking-summary-grid">
            {summaryCards.map((card) => (
              <article key={card.label} className="customer-booking-summary-card customer-account-summary-card">
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <p>{card.detail}</p>
              </article>
            ))}
          </section>

          <section className="customer-booking-section">
            <div className="customer-booking-section-header">
              <div>
                <h2>Active workshop jobs</h2>
                <p>Use this as the starting point for current progress, approvals, and collection readiness.</p>
              </div>
            </div>

            {dashboard && dashboard.activeJobs.length === 0 ? (
              <div className="customer-account-inline-banner">
                <strong>No active workshop jobs right now.</strong>
                <p>When a booking or repair is active, it will appear here automatically.</p>
                <Link className="button-link" to={publicSitePaths.bookWorkshop}>
                  Start a workshop booking
                </Link>
              </div>
            ) : null}

            <div className="customer-account-job-grid">
              {dashboard?.activeJobs.map((job) => (
                <article key={job.id} className="customer-account-job-card">
                  <div className="customer-account-job-card-header">
                    <div>
                      <p className="customer-booking-kicker">{job.statusLabel}</p>
                      <h3>{job.bikeDisplayName}</h3>
                    </div>
                    <span className="status-badge">{job.customerProgress.label}</span>
                  </div>

                  <p className="customer-account-job-headline">{job.customerProgress.headline}</p>
                  <p>{job.customerProgress.detail}</p>

                  <dl className="customer-account-job-meta">
                    <div>
                      <dt>Next step</dt>
                      <dd>{job.customerProgress.nextStep}</dd>
                    </div>
                    <div>
                      <dt>Collection status</dt>
                      <dd>{job.collection.headline}</dd>
                    </div>
                    <div>
                      <dt>Scheduled</dt>
                      <dd>{formatOptionalDateTime(job.scheduledStartAt || job.scheduledDate)}</dd>
                    </div>
                    <div>
                      <dt>Latest update</dt>
                      <dd>{formatOptionalDateTime(job.updatedAt)}</dd>
                    </div>
                  </dl>

                  {job.estimate ? (
                    <div className="customer-account-inline-banner customer-account-inline-banner--soft">
                      <strong>
                        Estimate v{job.estimate.version} · {job.estimate.status.replaceAll("_", " ")}
                      </strong>
                      <p>
                        {job.estimate.lineCount} line{job.estimate.lineCount === 1 ? "" : "s"} ·{" "}
                        {formatMoney(job.estimate.subtotalPence)}
                      </p>
                    </div>
                  ) : null}

                  {job.conversation?.latestMessage ? (
                    <div className="customer-account-message-preview">
                      <strong>Latest message</strong>
                      <p>{job.conversation.latestMessage.bodyPreview}</p>
                    </div>
                  ) : null}

                  <div className="customer-account-job-actions">
                    <Link className="button-link" to={job.links.primaryPath || publicSitePaths.account}>
                      {job.links.quotePath ? "Open approval or progress view" : "Open booking or progress view"}
                    </Link>
                    {job.links.managePath && job.links.managePath !== job.links.primaryPath ? (
                      <Link to={job.links.managePath}>Manage booking link</Link>
                    ) : null}
                    {job.links.quotePath && job.links.quotePath !== job.links.primaryPath ? (
                      <Link to={job.links.quotePath}>Quote approval link</Link>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="customer-booking-section">
            <div className="customer-booking-section-header">
              <div>
                <h2>Bikes on your account</h2>
                <p>These bikes can be reused in the booking flow so repeat visits feel less repetitive.</p>
              </div>
            </div>

            <div className="customer-account-bike-grid">
              {dashboard?.bikes.map((bike) => (
                <article key={bike.id} className="customer-booking-detail-card customer-account-bike-card">
                  <h3>{bike.displayName}</h3>
                  <p>
                    {bike.activeJobCount > 0
                      ? `${bike.activeJobCount} active workshop job${bike.activeJobCount === 1 ? "" : "s"}`
                      : "No active workshop jobs"}
                  </p>
                  <p>Latest service context: {formatOptionalDate(bike.latestServiceAt)}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="customer-booking-section">
            <div className="customer-booking-section-header">
              <div>
                <h2>Recent service history</h2>
                <p>This is the first step toward a fuller persistent customer history.</p>
              </div>
            </div>

            <div className="customer-account-history-grid">
              {dashboard?.recentHistory.map((item) => (
                <article key={item.id} className="customer-booking-detail-card customer-account-history-card">
                  <h3>{item.bikeDisplayName}</h3>
                  <p>{item.summary}</p>
                  <p>{item.totalPence !== null ? `Final total ${formatMoney(item.totalPence)}` : item.statusLabel}</p>
                  <p>{formatOptionalDateTime(item.completedAt)}</p>
                </article>
              ))}
            </div>
          </section>
        </section>
      </div>
    </PublicSiteLayout>
  );
};
