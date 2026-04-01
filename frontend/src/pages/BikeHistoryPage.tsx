import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api/client";
import { EntityTimelinePanel } from "../components/EntityTimelinePanel";
import { useToasts } from "../components/ToastProvider";
import { WorkshopCommercialInsightsPanel } from "../components/WorkshopCommercialInsightsPanel";
import { toBackendUrl } from "../utils/backendUrl";
import {
  bikeServiceScheduleDueStatusClass,
  bikeServiceScheduleDueStatusLabel,
  type BikeServiceScheduleDueStatus,
  type BikeServiceScheduleType,
} from "../features/bikes/serviceSchedules";
import {
  workshopEstimateStatusClass,
  workshopEstimateStatusLabel,
} from "../features/workshop/estimateStatus";
import {
  workshopExecutionStatusClass,
  workshopExecutionStatusLabel,
  workshopRawStatusClass,
  workshopRawStatusLabel,
  type WorkshopExecutionStatus,
} from "../features/workshop/status";
import { type WorkshopCommercialInsights } from "../features/workshop/commercialInsights";

type BikeServiceScheduleRecord = {
  id: string;
  bikeId: string;
  type: BikeServiceScheduleType;
  typeLabel: string;
  title: string;
  description: string | null;
  intervalMonths: number | null;
  intervalMileage: number | null;
  lastServiceAt: string | null;
  lastServiceMileage: number | null;
  nextDueAt: string | null;
  nextDueMileage: number | null;
  isActive: boolean;
  dueStatus: BikeServiceScheduleDueStatus;
  dueSummaryText: string;
  cadenceSummaryText: string;
  lastServiceSummaryText: string;
  createdAt: string;
  updatedAt: string;
};

type BikeHistoryEntry = {
  id: string;
  reference: string;
  title: string;
  jobPath: string;
  customerId: string | null;
  customerName: string | null;
  bikeDescription: string | null;
  serviceSummaryText: string;
  status: WorkshopExecutionStatus;
  rawStatus: string;
  scheduledDate: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  durationMinutes: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  closedAt: string | null;
  depositRequiredPence: number;
  depositStatus: string;
  finalizedBasketId: string | null;
  assignedTechnician: {
    id: string | null;
    name: string | null;
  } | null;
  notes: {
    jobNotes: string | null;
    noteCount: number;
    latestNote: {
      id: string;
      note: string;
      visibility: "INTERNAL" | "CUSTOMER";
      createdAt: string;
      authorName: string | null;
    } | null;
  };
  liveTotals: {
    lineCount: number;
    labourTotalPence: number;
    partsTotalPence: number;
    subtotalPence: number;
  };
  moneySummary: {
    labourTotalPence: number;
    partsTotalPence: number;
    liveSubtotalPence: number;
    estimateSubtotalPence: number | null;
    finalTotalPence: number | null;
    primaryTotalPence: number;
    primaryTotalSource: "FINAL_SALE" | "ESTIMATE" | "LIVE_TOTAL";
  };
  estimate: {
    id: string;
    version: number;
    status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "SUPERSEDED";
    labourTotalPence: number;
    partsTotalPence: number;
    subtotalPence: number;
    lineCount: number;
    requestedAt: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
    supersededAt: string | null;
    decisionSource: "STAFF" | "CUSTOMER" | null;
    createdAt: string;
    updatedAt: string;
    isCurrent: boolean;
    decisionByStaff: {
      id: string;
      name: string;
    } | null;
  } | null;
  sale: {
    id: string;
    subtotalPence: number;
    taxPence: number;
    totalPence: number;
    changeDuePence: number;
    createdAt: string;
    completedAt: string | null;
    receiptNumber: string | null;
    receiptUrl: string | null;
    issuedAt: string | null;
    checkoutStaff: {
      id: string;
      name: string;
    } | null;
    paymentSummary: {
      totalTenderedPence: number;
      methods: Array<{
        method: "CASH" | "CARD" | "BANK_TRANSFER" | "VOUCHER";
        label: string;
        amountPence: number;
      }>;
      summaryText: string;
    } | null;
  } | null;
};

type BikeHistoryPayload = {
  bike: {
    id: string;
    customerId: string;
    label: string | null;
    make: string | null;
    model: string | null;
    year: number | null;
    bikeType: string | null;
    colour: string | null;
    wheelSize: string | null;
    frameSize: string | null;
    groupset: string | null;
    motorBrand: string | null;
    motorModel: string | null;
    batterySerial: string | null;
    frameNumber: string | null;
    serialNumber: string | null;
    registrationNumber: string | null;
    notes: string | null;
    displayName: string;
    createdAt: string;
    updatedAt: string;
  };
  customer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  };
  workshopStartContext: {
    startPath: string;
    defaults: {
      customerId: string;
      customerName: string;
      bikeId: string;
      bikeDescription: string;
      status: "BOOKED";
    };
  };
  serviceSummary: {
    linkedJobCount: number;
    openJobCount: number;
    completedJobCount: number;
    firstJobAt: string | null;
    latestJobAt: string | null;
    latestCompletedAt: string | null;
  };
  metrics: {
    totalJobs: number;
    completedJobs: number;
    openJobs: number;
    lastServiceAt: string | null;
    lifetimeWorkshopSpendPence: number;
    finalizedSaleCount: number;
    lastActivityAt: string | null;
  };
  serviceSchedules: BikeServiceScheduleRecord[];
  serviceScheduleSummary: {
    activeCount: number;
    inactiveCount: number;
    dueCount: number;
    overdueCount: number;
    upcomingCount: number;
    primarySchedule: BikeServiceScheduleRecord | null;
  };
  commercialInsights: WorkshopCommercialInsights;
  limitations: string[];
  completedHistory: BikeHistoryEntry[];
  openWork: BikeHistoryEntry[];
  history: BikeHistoryEntry[];
};

type BikeHistoryTab = "history" | "timeline" | "openWork" | "details";

const BIKE_TYPE_LABELS: Record<string, string> = {
  ROAD: "Road",
  MTB: "Mountain bike",
  E_BIKE: "E-bike",
  HYBRID: "Hybrid",
  GRAVEL: "Gravel",
  COMMUTER: "Commuter",
  BMX: "BMX",
  KIDS: "Kids",
  CARGO: "Cargo",
  FOLDING: "Folding",
  OTHER: "Other",
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatOptionalDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "-";

const formatOptionalDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : "-";

const truncateText = (value: string, limit = 180) =>
  value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}...` : value;

const formatBikeType = (value: string | null | undefined) =>
  value ? BIKE_TYPE_LABELS[value] ?? value : "-";

const buildEstimateSummary = (entry: BikeHistoryEntry) => {
  if (!entry.estimate) {
    return "No saved estimate snapshot";
  }

  const scope = entry.estimate.isCurrent ? "current" : "latest saved";
  return `Estimate v${entry.estimate.version} ${workshopEstimateStatusLabel(entry.estimate.status)} · ${formatMoney(entry.estimate.subtotalPence)} · ${scope}`;
};

const buildEstimateDecisionSummary = (entry: BikeHistoryEntry) => {
  if (!entry.estimate) {
    return "No estimate saved";
  }

  if (entry.estimate.status === "APPROVED") {
    if (entry.estimate.decisionByStaff?.name) {
      return `Approved by ${entry.estimate.decisionByStaff.name}`;
    }
    if (entry.estimate.decisionSource === "CUSTOMER") {
      return "Approved through secure quote link";
    }
    return "Approved";
  }

  if (entry.estimate.status === "REJECTED") {
    if (entry.estimate.decisionByStaff?.name) {
      return `Rejected by ${entry.estimate.decisionByStaff.name}`;
    }
    if (entry.estimate.decisionSource === "CUSTOMER") {
      return "Rejected through secure quote link";
    }
    return "Rejected";
  }

  return workshopEstimateStatusLabel(entry.estimate.status);
};

const buildJobOutcomeSummary = (entry: BikeHistoryEntry) => {
  if (entry.sale) {
    const receiptContext = entry.sale.receiptNumber
      ? `Receipt ${entry.sale.receiptNumber}`
      : `Sale ${entry.sale.id.slice(0, 8).toUpperCase()}`;
    const paymentContext = entry.sale.paymentSummary?.summaryText
      ? ` via ${entry.sale.paymentSummary.summaryText}`
      : "";
    return `${receiptContext} completed for ${formatMoney(entry.sale.totalPence)}${paymentContext}.`;
  }

  if (entry.status === "READY") {
    return entry.finalizedBasketId
      ? `Ready for collection with POS basket ${entry.finalizedBasketId.slice(0, 8)}.`
      : "Ready for collection.";
  }

  if (entry.status === "COLLECTED") {
    return `Collected ${formatOptionalDateTime(entry.completedAt)}.`;
  }

  if (entry.rawStatus === "CANCELLED") {
    return "Cancelled before completion.";
  }

  return "No final sale has been captured yet.";
};

const buildHistoryDateSummary = (entry: BikeHistoryEntry) => {
  if (entry.completedAt) {
    return `Completed ${formatOptionalDate(entry.completedAt)}`;
  }

  if (entry.scheduledStartAt) {
    return `Booked ${formatOptionalDate(entry.scheduledStartAt)}`;
  }

  if (entry.scheduledDate) {
    return `Booked ${formatOptionalDate(entry.scheduledDate)}`;
  }

  return `Created ${formatOptionalDate(entry.createdAt)}`;
};

const buildOpenWorkDateSummary = (entry: BikeHistoryEntry) => {
  if (entry.status === "READY") {
    return `Ready since ${formatOptionalDateTime(entry.updatedAt)}`;
  }

  if (entry.scheduledStartAt) {
    return `Booked ${formatOptionalDateTime(entry.scheduledStartAt)}`;
  }

  if (entry.scheduledDate) {
    return `Booked ${formatOptionalDate(entry.scheduledDate)}`;
  }

  return `Updated ${formatOptionalDateTime(entry.updatedAt)}`;
};

const buildHeaderStatus = (payload: BikeHistoryPayload) => {
  if (payload.openWork.some((entry) => entry.status === "READY")) {
    return {
      label: "Ready for collection",
      tone: "active",
      detail: `${payload.openWork.filter((entry) => entry.status === "READY").length} bike-linked job${payload.openWork.filter((entry) => entry.status === "READY").length === 1 ? "" : "s"} waiting to be handed back.`,
    };
  }

  if (payload.openWork.length > 0) {
    return {
      label: "In workshop",
      tone: "active",
      detail: `${payload.openWork.length} active bike-linked job${payload.openWork.length === 1 ? "" : "s"} currently being worked.`,
    };
  }

  if (payload.serviceScheduleSummary.overdueCount > 0) {
    return {
      label: "Service overdue",
      tone: "attention",
      detail: `${payload.serviceScheduleSummary.overdueCount} care-plan item${payload.serviceScheduleSummary.overdueCount === 1 ? "" : "s"} is overdue.`,
    };
  }

  if (payload.serviceScheduleSummary.dueCount > 0) {
    return {
      label: "Service due",
      tone: "attention",
      detail: `${payload.serviceScheduleSummary.dueCount} care-plan item${payload.serviceScheduleSummary.dueCount === 1 ? "" : "s"} is currently due.`,
    };
  }

  if (payload.metrics.lastServiceAt) {
    return {
      label: "History current",
      tone: "calm",
      detail: `Last completed service recorded on ${formatOptionalDate(payload.metrics.lastServiceAt)}.`,
    };
  }

  return {
    label: "History building",
    tone: "neutral",
    detail: "This bike does not have a completed linked workshop history yet.",
  };
};

const buildPrimaryIdentityLine = (payload: BikeHistoryPayload) => {
  const fragments = [
    [payload.bike.make, payload.bike.model].filter(Boolean).join(" ").trim() || null,
    payload.bike.year ? `${payload.bike.year}` : null,
    formatBikeType(payload.bike.bikeType) !== "-" ? formatBikeType(payload.bike.bikeType) : null,
    payload.bike.colour,
  ].filter(Boolean);

  return fragments.length > 0 ? fragments.join(" · ") : "Structured bike profile";
};

const buildServiceScheduleSummary = (payload: BikeHistoryPayload) => {
  const parts = [
    payload.serviceScheduleSummary.activeCount > 0
      ? `${payload.serviceScheduleSummary.activeCount} active schedule${payload.serviceScheduleSummary.activeCount === 1 ? "" : "s"}`
      : null,
    payload.serviceScheduleSummary.dueCount > 0
      ? `${payload.serviceScheduleSummary.dueCount} due`
      : null,
    payload.serviceScheduleSummary.overdueCount > 0
      ? `${payload.serviceScheduleSummary.overdueCount} overdue`
      : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "No active care plan";
};

const buildJobDetailPreview = (entry: BikeHistoryEntry) => {
  if (entry.notes.latestNote) {
    return `${entry.notes.latestNote.visibility === "CUSTOMER" ? "Customer-visible" : "Internal"} note: ${truncateText(entry.notes.latestNote.note)}`;
  }

  if (entry.notes.jobNotes) {
    return `Check-in note: ${truncateText(entry.notes.jobNotes)}`;
  }

  return entry.serviceSummaryText;
};

const buildCommercialSummary = (entry: BikeHistoryEntry) => {
  if (!entry.sale) {
    return null;
  }

  const parts = [
    entry.sale.receiptNumber ? `Receipt ${entry.sale.receiptNumber}` : `Sale ${entry.sale.id.slice(0, 8).toUpperCase()}`,
    entry.sale.paymentSummary?.summaryText ?? null,
    entry.sale.checkoutStaff?.name ? `Checked out by ${entry.sale.checkoutStaff.name}` : null,
  ].filter(Boolean);

  return parts.join(" · ");
};

const JobCard = ({
  entry,
  mode,
}: {
  entry: BikeHistoryEntry;
  mode: "history" | "open";
}) => (
  <article className={`timeline-card bike-service-job-card bike-service-job-card--${mode}`}>
    <div className="bike-service-job-card__header">
      <div>
        <div className="bike-history-entry__date">
          {mode === "history" ? buildHistoryDateSummary(entry) : buildOpenWorkDateSummary(entry)}
        </div>
        <strong>
          <Link to={entry.jobPath}>Workshop Job {entry.reference}</Link>
        </strong>
        <div className="table-secondary">{entry.title}</div>
      </div>
      <div className="actions-inline">
        <span className={workshopExecutionStatusClass(entry.status, entry.rawStatus)}>
          {workshopExecutionStatusLabel(entry.status)}
        </span>
        {entry.estimate ? (
          <span className={workshopEstimateStatusClass(entry.estimate.status)}>
            {workshopEstimateStatusLabel(entry.estimate.status)}
          </span>
        ) : null}
      </div>
    </div>

    <div className="bike-service-job-card__totals">
      <div className="bike-service-job-card__total">
        <span className="metric-label">Labour</span>
        <strong>{formatMoney(entry.moneySummary.labourTotalPence)}</strong>
      </div>
      <div className="bike-service-job-card__total">
        <span className="metric-label">Parts</span>
        <strong>{formatMoney(entry.moneySummary.partsTotalPence)}</strong>
      </div>
      <div className="bike-service-job-card__total bike-service-job-card__total--primary">
        <span className="metric-label">{mode === "history" && entry.sale ? "Final" : "Current"}</span>
        <strong>{formatMoney(entry.moneySummary.primaryTotalPence)}</strong>
      </div>
    </div>

    <div className="bike-service-job-card__preview">
      {buildJobDetailPreview(entry)}
    </div>

    {mode === "history" ? (
      <div className="bike-service-job-card__commercial">
        {entry.sale ? (
          <>
            <span className="bike-service-job-card__commercial-badge">Finalized sale</span>
            <span>{buildCommercialSummary(entry)}</span>
          </>
        ) : (
          <span className="table-secondary">Completed workshop record without a finalized linked sale.</span>
        )}
      </div>
    ) : null}

    <div className="bike-history-entry__meta">
      <div><strong>Workflow:</strong> {workshopRawStatusLabel(entry.rawStatus)}</div>
      <div><strong>Technician:</strong> {entry.assignedTechnician?.name || "Unassigned"}</div>
      <div><strong>Booking:</strong> {formatOptionalDateTime(entry.scheduledStartAt || entry.scheduledDate)}</div>
      <div><strong>Estimate:</strong> {buildEstimateDecisionSummary(entry)}</div>
    </div>

    <details className="bike-service-job-card__details">
      <summary>Notes & summary</summary>
      <div className="bike-service-job-card__details-body">
        <p>{buildJobDetailPreview(entry)}</p>
        <p>{buildJobOutcomeSummary(entry)}</p>
        {entry.estimate ? <p>{buildEstimateSummary(entry)}</p> : null}
        {entry.notes.latestNote ? (
          <p className="table-secondary">
            Latest note by {entry.notes.latestNote.authorName || "Staff"} on {formatOptionalDateTime(entry.notes.latestNote.createdAt)}
          </p>
        ) : null}
        {entry.sale?.checkoutStaff?.name ? (
          <p className="table-secondary">
            Finalized by {entry.sale.checkoutStaff.name}
            {entry.sale.issuedAt ? ` on ${formatOptionalDateTime(entry.sale.issuedAt)}` : ""}
          </p>
        ) : null}
      </div>
    </details>

    <div className="actions-inline">
      <Link to={entry.jobPath}>Open workshop job</Link>
      {mode === "history" && entry.sale?.receiptUrl ? (
        <a href={toBackendUrl(entry.sale.receiptUrl)} target="_blank" rel="noreferrer">
          View receipt
        </a>
      ) : null}
      {mode === "history" ? (
        <span className="table-secondary">Completed {formatOptionalDateTime(entry.completedAt)}</span>
      ) : (
        <span className="table-secondary">Updated {formatOptionalDateTime(entry.updatedAt)}</span>
      )}
      <span className={workshopRawStatusClass(entry.rawStatus)}>
        {workshopRawStatusLabel(entry.rawStatus)}
      </span>
    </div>
  </article>
);

export const BikeHistoryPage = () => {
  const { bikeId } = useParams<{ bikeId: string }>();
  const { error } = useToasts();

  const [payload, setPayload] = useState<BikeHistoryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<BikeHistoryTab>("history");

  useEffect(() => {
    if (!bikeId) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const response = await apiGet<BikeHistoryPayload>(
          `/api/customers/bikes/${encodeURIComponent(bikeId)}`,
        );
        if (!cancelled) {
          setPayload(response);
        }
      } catch (loadError) {
        if (!cancelled) {
          const message = loadError instanceof Error
            ? loadError.message
            : "Failed to load bike service history";
          error(message);
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
  }, [bikeId, error]);

  const latestLimitation = useMemo(
    () => payload?.limitations?.[0] ?? null,
    [payload?.limitations],
  );
  const headerStatus = useMemo(
    () => (payload ? buildHeaderStatus(payload) : null),
    [payload],
  );

  if (!bikeId) {
    return <div className="page-shell"><p>Missing bike id.</p></div>;
  }

  return (
    <div className="page-shell">
      <section className="card bike-service-profile">
        <div className="bike-service-profile__hero">
          <div className="bike-service-profile__identity">
            <div className="bike-service-profile__eyebrow">Bike service history</div>
            {payload ? (
              <>
                <div className="bike-service-profile__title-row">
                  <h1>{payload.bike.displayName}</h1>
                  {headerStatus ? (
                    <span className={`bike-service-profile__status bike-service-profile__status--${headerStatus.tone}`}>
                      {headerStatus.label}
                    </span>
                  ) : null}
                </div>
                <p className="muted-text">{buildPrimaryIdentityLine(payload)}</p>
                {headerStatus ? (
                  <p className="bike-service-profile__status-detail">{headerStatus.detail}</p>
                ) : null}
                <div className="bike-service-profile__highlights">
                  <span><strong>Owner:</strong> <Link to={`/customers/${payload.customer.id}`}>{payload.customer.name}</Link></span>
                  <span><strong>Identifiers:</strong> {[payload.bike.registrationNumber, payload.bike.frameNumber, payload.bike.serialNumber].filter(Boolean).join(" · ") || "Not recorded"}</span>
                  <span><strong>Care plan:</strong> {buildServiceScheduleSummary(payload)}</span>
                </div>
              </>
            ) : (
              <>
                <h1>Bike Service History</h1>
                <p className="muted-text">Loading bike profile...</p>
              </>
            )}
          </div>

          {payload ? (
            <div className="actions-inline bike-service-profile__actions">
              <Link to={payload.workshopStartContext.startPath} className="button-link">
                Start Workshop Job
              </Link>
              <Link to={`/customers/${payload.customer.id}`} className="button-link">
                Customer Profile
              </Link>
            </div>
          ) : null}
        </div>

        {loading ? <p>Loading...</p> : null}

        {payload ? (
          <div className="bike-service-profile__metrics">
            <article className="summary-card">
              <span className="metric-label">Total jobs</span>
              <strong className="metric-value">{payload.metrics.totalJobs}</strong>
              <span className="table-secondary">{payload.metrics.completedJobs} completed linked jobs</span>
            </article>
            <article className="summary-card">
              <span className="metric-label">Last service</span>
              <strong className="metric-value bike-service-profile__metric-value--compact">
                {payload.metrics.lastServiceAt ? formatOptionalDate(payload.metrics.lastServiceAt) : "Not yet recorded"}
              </strong>
              <span className="table-secondary">
                Last activity {formatOptionalDate(payload.metrics.lastActivityAt)}
              </span>
            </article>
            <article className="summary-card">
              <span className="metric-label">Open work</span>
              <strong className="metric-value">{payload.metrics.openJobs}</strong>
              <span className="table-secondary">
                {payload.openWork.some((entry) => entry.status === "READY")
                  ? "Includes ready-for-collection work"
                  : "Active bike-linked workshop jobs"}
              </span>
            </article>
            <article className="summary-card">
              <span className="metric-label">Lifetime workshop spend</span>
              <strong className="metric-value bike-service-profile__metric-value--compact">
                {payload.metrics.finalizedSaleCount > 0
                  ? formatMoney(payload.metrics.lifetimeWorkshopSpendPence)
                  : "Not yet captured"}
              </strong>
              <span className="table-secondary">
                {payload.metrics.finalizedSaleCount > 0
                  ? `From ${payload.metrics.finalizedSaleCount} finalized bike-linked sale${payload.metrics.finalizedSaleCount === 1 ? "" : "s"}`
                  : "Shown only where finalized linked sales exist"}
              </span>
            </article>
          </div>
        ) : null}

        {latestLimitation ? (
          <div className="restricted-panel info-panel bike-service-profile__limitation">
            {latestLimitation}
          </div>
        ) : null}

        {payload?.commercialInsights ? (
          <WorkshopCommercialInsightsPanel
            insights={payload.commercialInsights}
            title="Service and revenue prompts"
            description="These prompts are generated from the bike's care plan, workshop history, and recorded bike type so staff can make relevant recommendations with a clear why."
            dataTestId="bike-history-commercial-insights"
          />
        ) : null}
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Bike service record</h2>
            <p className="muted-text">
              Keep completed history, operational timeline, live workshop activity, and bike details clearly separated.
            </p>
          </div>
          <div className="workshop-job-status-panel__tabs" role="tablist" aria-label="Bike service history views">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "history"}
              className={`workshop-job-status-panel__tab${activeTab === "history" ? " workshop-job-status-panel__tab--active" : ""}`}
              onClick={() => setActiveTab("history")}
            >
              History
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "timeline"}
              className={`workshop-job-status-panel__tab${activeTab === "timeline" ? " workshop-job-status-panel__tab--active" : ""}`}
              onClick={() => setActiveTab("timeline")}
            >
              Timeline
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "openWork"}
              className={`workshop-job-status-panel__tab${activeTab === "openWork" ? " workshop-job-status-panel__tab--active" : ""}`}
              onClick={() => setActiveTab("openWork")}
            >
              Open Work
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "details"}
              className={`workshop-job-status-panel__tab${activeTab === "details" ? " workshop-job-status-panel__tab--active" : ""}`}
              onClick={() => setActiveTab("details")}
            >
              Details
            </button>
          </div>
        </div>

        {!payload ? null : activeTab === "history" ? (
          payload.completedHistory.length > 0 ? (
            <div className="timeline-list bike-history-list">
              {payload.completedHistory.map((entry) => (
                <JobCard key={entry.id} entry={entry} mode="history" />
              ))}
            </div>
          ) : (
            <div className="restricted-panel bike-service-empty">
              <strong>No completed service history yet.</strong>
              <p>
                This bike is linked and ready, but it does not yet have a completed workshop job on record.
              </p>
            </div>
          )
        ) : null}

        {!payload ? null : activeTab === "timeline" ? (
          <EntityTimelinePanel
            entityType="BIKE"
            entityId={bikeId}
            hint="Operational domain events for this bike, newest first."
            emptyState="No operational timeline events have been recorded for this bike yet."
          />
        ) : null}

        {!payload ? null : activeTab === "openWork" ? (
          payload.openWork.length > 0 ? (
            <div className="bike-service-open-work">
              <div className="bike-service-open-work__summary">
                <strong>{payload.openWork.length} active job{payload.openWork.length === 1 ? "" : "s"}</strong>
                <span className="table-secondary">
                  {payload.openWork.some((entry) => entry.status === "READY")
                    ? "Ready work is surfaced first so collection handoffs are obvious."
                    : "Booked and in-progress work stays separate from the completed service record."}
                </span>
              </div>
              <div className="timeline-list bike-history-list">
                {payload.openWork.map((entry) => (
                  <JobCard key={entry.id} entry={entry} mode="open" />
                ))}
              </div>
            </div>
          ) : (
            <div className="restricted-panel bike-service-empty">
              <strong>No open workshop work for this bike.</strong>
              <p>
                The active queue is clear. Start a new linked workshop job when this bike comes back in.
              </p>
              <div className="actions-inline">
                <Link to={payload.workshopStartContext.startPath}>Start workshop job</Link>
              </div>
            </div>
          )
        ) : null}

        {!payload ? null : activeTab === "details" ? (
          <div className="bike-service-details">
            <div className="bike-service-details__grid">
              <article className="timeline-card bike-service-details__card">
                <h3>Bike details</h3>
                <div className="bike-service-details__table">
                  <div><strong>Owner</strong><span><Link to={`/customers/${payload.customer.id}`}>{payload.customer.name}</Link></span></div>
                  <div><strong>Label</strong><span>{payload.bike.label || "-"}</span></div>
                  <div><strong>Make / Model</strong><span>{[payload.bike.make, payload.bike.model].filter(Boolean).join(" ") || "-"}</span></div>
                  <div><strong>Year / Type</strong><span>{payload.bike.year ? `${payload.bike.year} · ${formatBikeType(payload.bike.bikeType)}` : formatBikeType(payload.bike.bikeType)}</span></div>
                  <div><strong>Colour</strong><span>{payload.bike.colour || "-"}</span></div>
                  <div><strong>Wheel / Frame</strong><span>{[payload.bike.wheelSize, payload.bike.frameSize].filter(Boolean).join(" · ") || "-"}</span></div>
                  <div><strong>Groupset</strong><span>{payload.bike.groupset || "-"}</span></div>
                  <div><strong>E-bike kit</strong><span>{[payload.bike.motorBrand, payload.bike.motorModel, payload.bike.batterySerial].filter(Boolean).join(" · ") || "-"}</span></div>
                </div>
              </article>

              <article className="timeline-card bike-service-details__card">
                <h3>Identifiers</h3>
                <div className="bike-service-details__table">
                  <div><strong>Registration</strong><span>{payload.bike.registrationNumber || "-"}</span></div>
                  <div><strong>Frame number</strong><span>{payload.bike.frameNumber || "-"}</span></div>
                  <div><strong>Serial number</strong><span>{payload.bike.serialNumber || "-"}</span></div>
                  <div><strong>Created</strong><span>{formatOptionalDateTime(payload.bike.createdAt)}</span></div>
                  <div><strong>Last updated</strong><span>{formatOptionalDateTime(payload.bike.updatedAt)}</span></div>
                  <div><strong>Workshop intake</strong><span><Link to={payload.workshopStartContext.startPath}>Start a new linked job</Link></span></div>
                </div>
              </article>
            </div>

            <article className="timeline-card bike-service-details__card">
              <div className="card-header-row">
                <div>
                  <h3>Bike care plan</h3>
                  <p className="muted-text">
                    Service schedules stay with the bike record so future work is visible before the next check-in.
                  </p>
                </div>
                <div className="table-secondary">{buildServiceScheduleSummary(payload)}</div>
              </div>

              {payload.serviceSchedules.length > 0 ? (
                <div className="bike-service-schedule-list">
                  {payload.serviceSchedules.map((schedule) => (
                    <article key={schedule.id} className="bike-service-schedule-card">
                      <div className="card-header-row">
                        <div>
                          <div className="actions-inline">
                            <strong>{schedule.title}</strong>
                            <span className={bikeServiceScheduleDueStatusClass(schedule.dueStatus)}>
                              {bikeServiceScheduleDueStatusLabel(schedule.dueStatus)}
                            </span>
                          </div>
                          <div className="table-secondary">
                            {schedule.typeLabel} · {schedule.cadenceSummaryText}
                          </div>
                        </div>
                        <div className="table-secondary">
                          Updated {formatOptionalDateTime(schedule.updatedAt)}
                        </div>
                      </div>

                      <div className="bike-service-schedule-card__meta">
                        <div><strong>Next due:</strong> {schedule.dueSummaryText}</div>
                        <div><strong>Last service:</strong> {schedule.lastServiceSummaryText}</div>
                        <div><strong>State:</strong> {schedule.isActive ? "Active" : "Inactive"}</div>
                        <div><strong>Next due date:</strong> {schedule.nextDueAt ? formatOptionalDate(schedule.nextDueAt) : "-"}</div>
                      </div>

                      {schedule.description ? (
                        <div className="table-secondary">{schedule.description}</div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="restricted-panel">
                  No service schedules yet. Add one from the customer profile to turn this into a true long-term bike record.
                </div>
              )}
            </article>

            <article className="timeline-card bike-service-details__card">
              <h3>Record notes</h3>
              <p>{payload.bike.notes || "No bike-level notes recorded yet."}</p>
            </article>
          </div>
        ) : null}
      </section>
    </div>
  );
};
