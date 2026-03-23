import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
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
  serviceSchedules: Array<{
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
  }>;
  serviceScheduleSummary: {
    activeCount: number;
    inactiveCount: number;
    dueCount: number;
    overdueCount: number;
    upcomingCount: number;
    primarySchedule: {
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
    } | null;
  };
  limitations: string[];
  history: Array<{
    id: string;
    jobPath: string;
    customerId: string | null;
    customerName: string | null;
    bikeDescription: string | null;
    serviceSummaryText: string;
    status: WorkshopExecutionStatus;
    rawStatus: string;
    scheduledDate: string | null;
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
      createdAt: string;
      updatedAt: string;
      isCurrent: boolean;
    } | null;
    sale: {
      id: string;
      totalPence: number;
      createdAt: string;
      completedAt: string | null;
    } | null;
  }>;
};

const formatMoney = (pence: number) => `GBP ${(pence / 100).toFixed(2)}`;
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

const formatOptionalDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "-";

const truncateText = (value: string, limit = 140) =>
  value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}...` : value;

const formatBikeType = (value: string | null | undefined) =>
  value ? BIKE_TYPE_LABELS[value] ?? value : "-";

const buildEstimateSummary = (
  estimate: BikeHistoryPayload["history"][number]["estimate"],
) => {
  if (!estimate) {
    return "No saved estimate snapshot";
  }

  const scope = estimate.isCurrent ? "current" : "latest saved";
  return `v${estimate.version} ${workshopEstimateStatusLabel(estimate.status)} · ${formatMoney(estimate.subtotalPence)} · ${scope}`;
};

const buildOutcomeSummary = (
  entry: BikeHistoryPayload["history"][number],
) => {
  if (entry.sale) {
    return `Sale ${entry.sale.id.slice(0, 8)} completed for ${formatMoney(entry.sale.totalPence)}.`;
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

  return "No sale outcome recorded yet.";
};

const buildHistoryDateSummary = (
  entry: BikeHistoryPayload["history"][number],
) => {
  if (entry.scheduledDate) {
    return `Scheduled ${formatOptionalDateTime(entry.scheduledDate)}`;
  }

  if (entry.completedAt) {
    return `Completed ${formatOptionalDateTime(entry.completedAt)}`;
  }

  return `Created ${formatOptionalDateTime(entry.createdAt)}`;
};

const buildHistoryMoneySummary = (
  entry: BikeHistoryPayload["history"][number],
) => {
  const totals = [
    `Labour ${formatMoney(entry.moneySummary.labourTotalPence)}`,
    `Parts ${formatMoney(entry.moneySummary.partsTotalPence)}`,
  ];

  if (entry.moneySummary.primaryTotalSource === "FINAL_SALE") {
    totals.push(`Final ${formatMoney(entry.moneySummary.primaryTotalPence)}`);
  } else if (entry.moneySummary.primaryTotalSource === "ESTIMATE") {
    totals.push(`Estimate ${formatMoney(entry.moneySummary.primaryTotalPence)}`);
  } else {
    totals.push(`Current ${formatMoney(entry.moneySummary.primaryTotalPence)}`);
  }

  return totals.join(" · ");
};

const buildHistoryCommercialSummary = (
  entry: BikeHistoryPayload["history"][number],
) => {
  if (entry.sale) {
    return `Final sale ${entry.sale.id.slice(0, 8)} completed for ${formatMoney(entry.sale.totalPence)}.`;
  }

  if (entry.estimate) {
    return buildEstimateSummary(entry.estimate);
  }

  return `${entry.liveTotals.lineCount} live workshop line${entry.liveTotals.lineCount === 1 ? "" : "s"} recorded.`;
};

export const BikeHistoryPage = () => {
  const { bikeId } = useParams<{ bikeId: string }>();
  const { error } = useToasts();

  const [payload, setPayload] = useState<BikeHistoryPayload | null>(null);
  const [loading, setLoading] = useState(false);

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

  if (!bikeId) {
    return <div className="page-shell"><p>Missing bike id.</p></div>;
  }

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Bike Service History</h1>
            <p className="muted-text">
              Review the linked workshop record for this bike while keeping older free-text-only jobs clearly separate.
            </p>
          </div>
          {payload ? (
            <div className="actions-inline">
              <Link to={payload.workshopStartContext.startPath} className="button-link">
                Start Workshop Job
              </Link>
              <Link to={`/customers/${payload.customer.id}`} className="button-link">
                Customer Profile
              </Link>
              <Link to={`/customers/${payload.customer.id}/timeline`} className="button-link">
                Open Timeline
              </Link>
            </div>
          ) : null}
        </div>

        {loading ? <p>Loading...</p> : null}

        {payload ? (
          <>
            <div className="job-meta-grid">
              <div><strong>Bike:</strong> {payload.bike.displayName}</div>
              <div>
                <strong>Customer:</strong>{" "}
                <Link to={`/customers/${payload.customer.id}`}>{payload.customer.name}</Link>
              </div>
              <div><strong>Make / Model:</strong> {[payload.bike.make, payload.bike.model].filter(Boolean).join(" ") || "-"}</div>
              <div><strong>Year / Type:</strong> {payload.bike.year ? `${payload.bike.year} · ${formatBikeType(payload.bike.bikeType)}` : formatBikeType(payload.bike.bikeType)}</div>
              <div><strong>Colour:</strong> {payload.bike.colour || "-"}</div>
              <div><strong>Wheel / Frame:</strong> {[payload.bike.wheelSize, payload.bike.frameSize].filter(Boolean).join(" · ") || "-"}</div>
              <div><strong>Groupset:</strong> {payload.bike.groupset || "-"}</div>
              <div><strong>Frame #:</strong> {payload.bike.frameNumber || "-"}</div>
              <div><strong>Serial #:</strong> {payload.bike.serialNumber || "-"}</div>
              <div><strong>Registration:</strong> {payload.bike.registrationNumber || "-"}</div>
              <div><strong>E-bike:</strong> {[payload.bike.motorBrand, payload.bike.motorModel, payload.bike.batterySerial].filter(Boolean).join(" · ") || "-"}</div>
              <div><strong>Bike Notes:</strong> {payload.bike.notes || "-"}</div>
              <div><strong>Linked Jobs:</strong> {payload.serviceSummary.linkedJobCount}</div>
              <div><strong>Open Jobs:</strong> {payload.serviceSummary.openJobCount}</div>
              <div><strong>Completed Jobs:</strong> {payload.serviceSummary.completedJobCount}</div>
              <div><strong>Latest Completed Service:</strong> {formatOptionalDateTime(payload.serviceSummary.latestCompletedAt)}</div>
              <div>
                <strong>Workshop Intake:</strong>{" "}
                <Link to={payload.workshopStartContext.startPath}>Start a new job for this bike</Link>
              </div>
            </div>

            {latestLimitation ? (
              <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
                {latestLimitation}
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Service Lifecycle</h2>
            <p className="muted-text">
              Keep the next planned service visible on the bike itself, not just in past workshop history.
            </p>
          </div>
          {payload ? (
            <div className="actions-inline">
              <Link to={`/customers/${payload.customer.id}`}>Manage on customer profile</Link>
              <span className="table-secondary">
                {payload.serviceScheduleSummary.activeCount} active · {payload.serviceScheduleSummary.dueCount} due · {payload.serviceScheduleSummary.overdueCount} overdue
              </span>
            </div>
          ) : null}
        </div>

        {!payload ? null : payload.serviceSchedules.length === 0 ? (
          <div className="restricted-panel">
            No bike service schedules yet. Add one from the customer profile to start tracking what this bike is due for next.
          </div>
        ) : (
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
                  <div>
                    <strong>Next due date:</strong> {schedule.nextDueAt ? formatOptionalDate(schedule.nextDueAt) : "-"}
                  </div>
                </div>

                {schedule.description ? (
                  <div className="table-secondary">{schedule.description}</div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Workshop History</h2>
            <p className="muted-text">
              Most recent linked workshop jobs first, with execution progress shown separately from quote state.
            </p>
          </div>
          {payload ? (
            <div className="table-secondary">
              {payload.history.length} linked job{payload.history.length === 1 ? "" : "s"}
            </div>
          ) : null}
        </div>

        {!payload ? null : payload.history.length === 0 ? (
          <div className="restricted-panel">
            No linked workshop jobs yet. This bike record will start building service history as soon as jobs are linked to it.
          </div>
        ) : (
          <div className="timeline-list bike-history-list">
            {payload.history.map((entry) => (
              <article key={entry.id} className="timeline-card bike-history-entry">
                <div className="bike-history-entry__header">
                  <div>
                    <div className="bike-history-entry__date">{buildHistoryDateSummary(entry)}</div>
                    <strong>
                      <Link to={entry.jobPath}>Workshop Job {entry.id.slice(0, 8)}</Link>
                    </strong>
                    <div className="table-secondary">
                      {entry.bikeDescription || payload.bike.displayName}
                    </div>
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

                <div className="bike-history-entry__summary">{entry.serviceSummaryText}</div>

                <div className="bike-history-entry__meta">
                  <div><strong>Money:</strong> {buildHistoryMoneySummary(entry)}</div>
                  <div><strong>Commercial state:</strong> {buildHistoryCommercialSummary(entry)}</div>
                  <div><strong>Technician:</strong> {entry.assignedTechnician?.name || "Unassigned"}</div>
                  <div><strong>Workflow detail:</strong> {workshopRawStatusLabel(entry.rawStatus)}</div>
                </div>

                {entry.notes.latestNote ? (
                  <div className="table-secondary">
                    Latest note: {truncateText(entry.notes.latestNote.note)} ({entry.notes.latestNote.visibility.toLowerCase()}, {formatOptionalDateTime(entry.notes.latestNote.createdAt)})
                  </div>
                ) : entry.notes.jobNotes ? (
                  <div className="table-secondary">Check-in note: {truncateText(entry.notes.jobNotes)}</div>
                ) : null}

                <div className="actions-inline">
                  <Link to={entry.jobPath}>Open workshop job</Link>
                  {entry.completedAt ? (
                    <span className="table-secondary">Completed {formatOptionalDateTime(entry.completedAt)}</span>
                  ) : (
                    <span className="table-secondary">Updated {formatOptionalDateTime(entry.updatedAt)}</span>
                  )}
                  <span className={workshopRawStatusClass(entry.rawStatus)}>
                    {workshopRawStatusLabel(entry.rawStatus)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
