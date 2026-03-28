import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { WorkshopJobOverlay, type WorkshopJobOverlaySummary } from "../features/workshop/WorkshopJobOverlay";
import {
  workshopRawStatusSurfaceClass,
  workshopRawStatusClass,
  workshopRawStatusLabel,
} from "../features/workshop/status";

type CalendarJob = {
  id: string;
  jobPath: string;
  locationId: string;
  customerId: string | null;
  bikeId: string | null;
  customerName: string | null;
  bikeDescription: string | null;
  summaryText: string;
  status: string;
  rawStatus: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  scheduledDate: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  durationMinutes: number | null;
  notes: string | null;
  completedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type CalendarWorkingHours = {
  id: string;
  date: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  totalMinutes: number;
  source: "ROTA" | "WORKSHOP_FALLBACK";
  shiftType: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOLIDAY" | null;
  label: string;
};

type CalendarAvailability = {
  date: string;
  dayOfWeek: number;
  source: "ROTA" | "WORKSHOP_FALLBACK" | "UNAVAILABLE";
  shiftType: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOLIDAY" | null;
  startTime: string | null;
  endTime: string | null;
  totalMinutes: number;
  label: string;
};

type CalendarTimeOff = {
  id: string;
  scope: "WORKSHOP" | "STAFF";
  staffId: string | null;
  startAt: string;
  endAt: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
};

type CalendarCapacity = {
  staffId: string;
  date: string;
  totalMinutes: number;
  bookedMinutes: number;
  timeOffMinutes: number;
  availableMinutes: number;
};

type CalendarStaffRow = {
  id: string;
  name: string;
  username: string;
  role: "STAFF" | "MANAGER" | "ADMIN";
  operationalRole: "WORKSHOP" | "SALES" | "ADMIN" | "MIXED" | null;
  workingHours: CalendarWorkingHours[];
  availability: CalendarAvailability[];
  timeOff: CalendarTimeOff[];
  dailyCapacity: CalendarCapacity[];
  scheduledJobs: CalendarJob[];
};

type CalendarResponse = {
  range: {
    from: string;
    to: string;
    timeZone: string;
  };
  locationId: string | null;
  usesOperationalRoleTags: boolean;
  days: Array<{
    date: string;
    weekday: string;
    opensAt: string | null;
    closesAt: string | null;
    isClosed: boolean;
    closedReason: string | null;
  }>;
  scheduledJobs: CalendarJob[];
  unassignedJobs: CalendarJob[];
  unscheduledJobs: CalendarJob[];
  workshopTimeOff: CalendarTimeOff[];
  staff: CalendarStaffRow[];
};

type SchedulePatchResponse = {
  job: {
    id: string;
    status: string;
    rawStatus: string | null;
    assignedStaffId: string | null;
    assignedStaffName: string | null;
    scheduledDate: string | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    durationMinutes: number | null;
    updatedAt: string;
  };
  idempotent: boolean;
};

type WorkshopSchedulerScreenProps = {
  embedded?: boolean;
  refreshToken?: number;
  showToolbar?: boolean;
  title?: string;
  description?: string;
  backLinkTo?: string | null;
  view?: CalendarViewMode;
  anchorDateKey?: string;
  onChangeView?: (view: CalendarViewMode) => void;
  onChangeAnchorDateKey?: (dateKey: string) => void;
  technicianId?: string;
  onTechnicianIdChange?: (technicianId: string) => void;
  visibleJobIds?: ReadonlySet<string> | null;
  requestedOverlayJobId?: string | null;
  onRequestedOverlayJobHandled?: () => void;
};

export type CalendarViewMode = "week" | "day";

type WorkshopOverlayTechnicianOption = {
  id: string;
  name: string;
};

type ScheduleDraft = {
  staffId: string;
  dateKey: string;
  startTime: string;
  durationMinutes: string;
};

type PositionedJob = {
  job: CalendarJob;
  top: number;
  height: number;
  left: number;
  width: number;
};

type DragState = {
  source: "calendar" | "queue";
  pointerId: number;
  job: CalendarJob;
  dateKey: string | null;
  staffId: string | null;
  left: number;
  width: number;
  height: number;
  pointerOffsetY: number;
  startClientX: number;
  startClientY: number;
  currentTop: number;
  snappedStartMinutes: number;
  durationMinutes: number;
  active: boolean;
};

type TimeOffBlock = {
  id: string;
  top: number;
  height: number;
  scope: "WORKSHOP" | "STAFF";
  label: string;
};

const DEFAULT_OPEN_MINUTES = 9 * 60;
const DEFAULT_CLOSE_MINUTES = 18 * 60;
const PX_PER_MINUTE = 1.05;
const WEEK_DAY_WIDTH = 244;
const DAY_VIEW_WIDTH = 460;
const JOB_BLOCK_GAP = 6;
const MIN_BOOKING_BLOCK_HEIGHT = 48;
const COMPACT_BOOKING_BLOCK_HEIGHT = 72;
const DURATION_PRESETS = [30, 45, 60, 90, 120, 180];
const DRAG_SNAP_MINUTES = 15;
const DRAG_START_THRESHOLD_PX = 6;

const formatDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateKey = (value: string) => {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

export const workshopTodayDateKey = () => formatDateKey(new Date());

const toOverlaySummary = (job: CalendarJob): WorkshopJobOverlaySummary => ({
  id: job.id,
  rawStatus: job.rawStatus,
  status: job.status,
  customerId: job.customerId,
  customerName: job.customerName,
  assignedStaffId: job.assignedStaffId,
  bikeDescription: job.bikeDescription,
  assignedStaffName: job.assignedStaffName,
  scheduledDate: job.scheduledDate,
  scheduledStartAt: job.scheduledStartAt,
  scheduledEndAt: job.scheduledEndAt,
  durationMinutes: job.durationMinutes,
  notes: job.notes,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const startOfWeek = (value: Date) => {
  const next = new Date(value);
  const day = next.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + mondayOffset);
  return next;
};

const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
};

const parseClockMinutes = (value: string | null | undefined) => {
  if (!value || !value.includes(":")) {
    return null;
  }

  const [hours, minutes] = value.split(":").map((part) => Number(part));
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }

  return (hours * 60) + minutes;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const formatClockLabel = (minutes: number) => {
  const clamped = clamp(minutes, 0, (24 * 60) - 1);
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${`${hours}`.padStart(2, "0")}:${`${mins}`.padStart(2, "0")}`;
};

const getTimeZoneParts = (value: Date, timeZone?: string) => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    ...(timeZone ? { timeZone } : {}),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(value);
  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
    hour: Number(lookup("hour") || "0"),
    minute: Number(lookup("minute") || "0"),
  };
};

const getDateKeyInTimeZone = (value: string | Date | null | undefined, timeZone?: string) => {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const parts = getTimeZoneParts(parsed, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const getMinutesInTimeZone = (value: string | Date | null | undefined, timeZone?: string) => {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const parts = getTimeZoneParts(parsed, timeZone);
  return (parts.hour * 60) + parts.minute;
};

const formatOptionalTime = (value: string | null | undefined, timeZone?: string) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        ...(timeZone ? { timeZone } : {}),
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

const formatOptionalDate = (value: string | null | undefined, timeZone?: string) =>
  value
    ? new Date(value).toLocaleDateString([], {
        ...(timeZone ? { timeZone } : {}),
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : "-";

const formatPromiseDate = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  const dateKey = value.slice(0, 10);
  return new Date(`${dateKey}T12:00:00.000Z`).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

const toTimeInputValue = (isoValue: string | null | undefined, timeZone?: string) => {
  if (!isoValue) {
    return "";
  }

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = getTimeZoneParts(date, timeZone);
  return `${`${parts.hour}`.padStart(2, "0")}:${`${parts.minute}`.padStart(2, "0")}`;
};

const buildScheduleIso = (dateKey: string, timeValue: string) => {
  if (!dateKey || !timeValue) {
    return null;
  }

  const date = new Date(`${dateKey}T${timeValue}:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
};

const getJobHeading = (job: CalendarJob) =>
  job.bikeDescription || job.customerName || job.summaryText || `Workshop job ${job.id.slice(0, 8)}`;

const getJobSubline = (job: CalendarJob) =>
  [job.customerName, job.assignedStaffName].filter(Boolean).join(" · ") || workshopRawStatusLabel(job.rawStatus);

const getBookingCustomerName = (job: CalendarJob) =>
  job.customerName || "Customer pending";

const getBookingBikeLine = (job: CalendarJob) =>
  job.bikeDescription?.trim() || "Bike details pending";

const getBookingMetaLine = (job: CalendarJob, todayKey: string, timeZone?: string) => {
  if (isOverdueJob(job, todayKey, timeZone)) {
    return "Overdue";
  }

  switch (job.rawStatus) {
    case "BIKE_ARRIVED":
    case "WAITING_FOR_APPROVAL":
    case "WAITING_FOR_PARTS":
    case "READY_FOR_COLLECTION":
      return workshopRawStatusLabel(job.rawStatus);
    default:
      return job.assignedStaffName?.trim() || "Scheduled";
  }
};

const getBookingServiceLabel = (job: CalendarJob) => {
  const trimmed = job.summaryText?.trim();
  if (!trimmed) {
    return null;
  }

  const bikeLine = getBookingBikeLine(job);
  const customerName = getBookingCustomerName(job);
  if (trimmed === bikeLine || trimmed === customerName) {
    return null;
  }

  return trimmed;
};

const getBookingTooltip = (job: CalendarJob, timeZone?: string) => {
  const details = [
    `${formatOptionalTime(job.scheduledStartAt, timeZone)} - ${formatOptionalTime(job.scheduledEndAt, timeZone)}`,
    getBookingCustomerName(job),
    getBookingBikeLine(job),
  ];

  const serviceLabel = getBookingServiceLabel(job);
  if (serviceLabel) {
    details.push(serviceLabel);
  }

  details.push(job.assignedStaffName ? `Technician: ${job.assignedStaffName}` : "Technician: Unassigned");
  details.push(`Status: ${workshopRawStatusLabel(job.rawStatus)}`);
  if (job.scheduledDate) {
    details.push(`Promise date: ${formatPromiseDate(job.scheduledDate)}`);
  }

  return details.join("\n");
};

const getJobOperationalDateKey = (job: CalendarJob, timeZone?: string) =>
  getDateKeyInTimeZone(job.scheduledStartAt, timeZone);

const getJobPromiseDateKey = (job: CalendarJob) =>
  job.scheduledDate?.slice(0, 10) ?? null;

const getJobDueDateKey = (job: CalendarJob, timeZone?: string) =>
  getJobPromiseDateKey(job) || getJobOperationalDateKey(job, timeZone);

const isOverdueJob = (job: CalendarJob, todayKey: string, timeZone?: string) => {
  const jobDateKey = getJobDueDateKey(job, timeZone);
  return Boolean(
    jobDateKey
      && jobDateKey < todayKey
      && !["COMPLETED", "CANCELLED", "READY_FOR_COLLECTION"].includes(job.rawStatus),
  );
};

const buildVisibleRange = (anchorDateKey: string, view: CalendarViewMode) => {
  const anchor = parseDateKey(anchorDateKey);
  const start = view === "week" ? startOfWeek(anchor) : anchor;
  const end = view === "week" ? addDays(start, 6) : start;
  const dates: string[] = [];

  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    dates.push(formatDateKey(cursor));
  }

  return {
    from: formatDateKey(start),
    to: formatDateKey(end),
    dates,
  };
};

export const shiftWorkshopAnchorDateKey = (anchorDateKey: string, view: CalendarViewMode, direction: -1 | 1) => {
  const anchor = parseDateKey(anchorDateKey);
  anchor.setDate(anchor.getDate() + (view === "week" ? direction * 7 : direction));
  return formatDateKey(anchor);
};

const buildTimelineRange = (days: CalendarResponse["days"]) => {
  const openCandidates = days
    .map((day) => parseClockMinutes(day.opensAt))
    .filter((value): value is number => value !== null);
  const closeCandidates = days
    .map((day) => parseClockMinutes(day.closesAt))
    .filter((value): value is number => value !== null);

  const openMinutes = openCandidates.length ? Math.min(...openCandidates) : DEFAULT_OPEN_MINUTES;
  const closeMinutes = closeCandidates.length ? Math.max(...closeCandidates) : DEFAULT_CLOSE_MINUTES;
  const normalizedClose = closeMinutes > openMinutes ? closeMinutes : openMinutes + 60;

  return {
    openMinutes,
    closeMinutes: normalizedClose,
    totalMinutes: normalizedClose - openMinutes,
  };
};

const toTimeLabels = (timeline: { openMinutes: number; closeMinutes: number }) => {
  const labels: number[] = [];
  const startHour = Math.floor(timeline.openMinutes / 60) * 60;
  const endHour = Math.ceil(timeline.closeMinutes / 60) * 60;

  for (let minutes = startHour; minutes <= endHour; minutes += 60) {
    labels.push(minutes);
  }

  return labels;
};

const formatRangeHeading = (days: CalendarResponse["days"], view: CalendarViewMode) => {
  if (days.length === 0) {
    return "Workshop schedule";
  }

  const first = parseDateKey(days[0].date);
  const last = parseDateKey(days[days.length - 1].date);

  if (view === "day" || days.length === 1) {
    return first.toLocaleDateString([], {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }

  return `${first.toLocaleDateString([], {
    day: "numeric",
    month: "short",
  })} - ${last.toLocaleDateString([], {
    day: "numeric",
    month: "short",
  })}`;
};

const toDayCapacitySummary = (
  staffRows: CalendarStaffRow[],
  dateKey: string,
  technicianId: string,
) => {
  const rows = technicianId
    ? staffRows.filter((staff) => staff.id === technicianId)
    : staffRows;

  return rows.reduce(
    (summary, staff) => {
      const capacity = staff.dailyCapacity.find((entry) => entry.date === dateKey);
      if (!capacity) {
        return summary;
      }

      return {
        totalMinutes: summary.totalMinutes + capacity.totalMinutes,
        bookedMinutes: summary.bookedMinutes + capacity.bookedMinutes,
        availableMinutes: summary.availableMinutes + capacity.availableMinutes,
      };
    },
    {
      totalMinutes: 0,
      bookedMinutes: 0,
      availableMinutes: 0,
    },
  );
};

const getWorkshopTimeOffBlocksForDay = (
  entries: CalendarTimeOff[],
  dateKey: string,
  openMinutes: number,
  closeMinutes: number,
  timeZone?: string,
) => {
  return entries.flatMap<TimeOffBlock>((entry) => {
    const start = new Date(entry.startAt);
    const end = new Date(entry.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return [];
    }
    const startDateKey = getDateKeyInTimeZone(start, timeZone);
    const endDateKey = getDateKeyInTimeZone(end, timeZone);
    if (!startDateKey || !endDateKey || endDateKey < dateKey || startDateKey > dateKey) {
      return [];
    }

    const startMinutes = startDateKey < dateKey ? 0 : getMinutesInTimeZone(start, timeZone);
    const endMinutes = endDateKey > dateKey ? 24 * 60 : getMinutesInTimeZone(end, timeZone);
    if (startMinutes === null || endMinutes === null) {
      return [];
    }

    const clippedStart = clamp(startMinutes, openMinutes, closeMinutes);
    const clippedEnd = clamp(endMinutes, openMinutes, closeMinutes);

    if (clippedEnd <= clippedStart) {
      return [];
    }

    return [{
      id: `${entry.id}-${dateKey}`,
      top: (clippedStart - openMinutes) * PX_PER_MINUTE,
      height: Math.max(18, (clippedEnd - clippedStart) * PX_PER_MINUTE),
      scope: entry.scope,
      label: entry.reason || (entry.scope === "WORKSHOP" ? "Workshop block" : "Time off"),
    }];
  });
};

const toPositionedJobs = (
  jobs: CalendarJob[],
  openMinutes: number,
  closeMinutes: number,
  columnWidth: number,
  timeZone?: string,
) => {
  const sortableJobs = jobs
    .map((job) => {
      if (!job.scheduledStartAt || !job.scheduledEndAt) {
        return null;
      }

      const start = new Date(job.scheduledStartAt);
      const end = new Date(job.scheduledEndAt);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return null;
      }

      const startMinutes = getMinutesInTimeZone(start, timeZone);
      const endMinutes = getMinutesInTimeZone(end, timeZone);
      if (startMinutes === null || endMinutes === null) {
        return null;
      }
      const clippedStart = clamp(startMinutes, openMinutes, closeMinutes);
      const clippedEnd = clamp(endMinutes, openMinutes, closeMinutes);

      if (clippedEnd <= clippedStart) {
        return null;
      }

      return {
        job,
        startMinutes,
        endMinutes,
        clippedStart,
        clippedEnd,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) =>
      left.startMinutes - right.startMinutes
      || left.endMinutes - right.endMinutes
      || left.job.createdAt.localeCompare(right.job.createdAt));

  const laneEndMinutes: number[] = [];
  let laneCount = 0;

  const laneAssignments = sortableJobs.map((entry) => {
    let laneIndex = laneEndMinutes.findIndex((laneEnd) => laneEnd <= entry.startMinutes);
    if (laneIndex === -1) {
      laneIndex = laneEndMinutes.length;
      laneEndMinutes.push(entry.endMinutes);
    } else {
      laneEndMinutes[laneIndex] = entry.endMinutes;
    }

    laneCount = Math.max(laneCount, laneEndMinutes.length);
    return {
      ...entry,
      laneIndex,
    };
  });

  const effectiveLaneCount = Math.max(1, laneCount);
  const totalGap = JOB_BLOCK_GAP * (effectiveLaneCount - 1);
  const laneWidth = Math.max(72, (columnWidth - totalGap) / effectiveLaneCount);

  return laneAssignments.map<PositionedJob>((entry) => ({
    job: entry.job,
    top: (entry.clippedStart - openMinutes) * PX_PER_MINUTE,
    height: Math.max(MIN_BOOKING_BLOCK_HEIGHT, (entry.clippedEnd - entry.clippedStart) * PX_PER_MINUTE),
    left: entry.laneIndex * (laneWidth + JOB_BLOCK_GAP),
    width: laneWidth,
  }));
};

const buildInitialDraft = (
  job: CalendarJob,
  preferredDateKey: string,
  calendarDay: CalendarResponse["days"][number] | undefined,
  timeZone?: string,
): ScheduleDraft => ({
  staffId: job.assignedStaffId || "",
  dateKey: getJobOperationalDateKey(job, timeZone) || preferredDateKey,
  startTime: toTimeInputValue(job.scheduledStartAt, timeZone) || calendarDay?.opensAt || "10:00",
  durationMinutes: `${job.durationMinutes || 60}`,
});

const getScheduledDurationMinutes = (job: CalendarJob, timeZone?: string) => {
  if (job.durationMinutes && job.durationMinutes > 0) {
    return job.durationMinutes;
  }

  const startMinutes = getMinutesInTimeZone(job.scheduledStartAt, timeZone);
  const endMinutes = getMinutesInTimeZone(job.scheduledEndAt, timeZone);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return 60;
  }

  return endMinutes - startMinutes;
};

const snapMinutesToGrid = (minutes: number, intervalMinutes: number) =>
  Math.round(minutes / intervalMinutes) * intervalMinutes;

const buildBlockTimeLabel = (startMinutes: number, durationMinutes: number) =>
  `${formatClockLabel(startMinutes)} - ${formatClockLabel(startMinutes + durationMinutes)}`;

const buildPreviewPosition = (input: {
  job: CalendarJob;
  jobs: CalendarJob[];
  dateKey: string;
  startMinutes: number;
  durationMinutes: number;
  openMinutes: number;
  closeMinutes: number;
  columnWidth: number;
  timeZone?: string;
}) => {
  const previewStartAt = buildScheduleIso(input.dateKey, formatClockLabel(input.startMinutes));
  const previewEndAt = buildScheduleIso(
    input.dateKey,
    formatClockLabel(input.startMinutes + input.durationMinutes),
  );

  if (!previewStartAt || !previewEndAt) {
    return null;
  }

  const previewJob: CalendarJob = {
    ...input.job,
    id: `${input.job.id}::drag-preview`,
    scheduledStartAt: previewStartAt,
    scheduledEndAt: previewEndAt,
    durationMinutes: input.durationMinutes,
  };

  return toPositionedJobs(
    [...input.jobs.filter((job) => job.id !== input.job.id), previewJob],
    input.openMinutes,
    input.closeMinutes,
    input.columnWidth,
    input.timeZone,
  ).find((entry) => entry.job.id === previewJob.id) ?? null;
};

const renderSchedulerBlockContent = ({
  job,
  timeLabel,
  metaLabel,
  isCompactBlock,
}: {
  job: CalendarJob;
  timeLabel: string;
  metaLabel: string;
  isCompactBlock: boolean;
}) => (
  <>
    <div className="workshop-scheduler-block__time">{timeLabel}</div>
    <strong className="workshop-scheduler-block__customer">
      {getBookingCustomerName(job)}
    </strong>
    <div className="workshop-scheduler-block__bike">
      {getBookingBikeLine(job)}
    </div>
    {!isCompactBlock ? (
      <div className="workshop-scheduler-block__meta">
        {metaLabel}
      </div>
    ) : null}
  </>
);

const buildJobToneClass = (job: CalendarJob, todayKey: string, timeZone?: string) => {
  const classes = ["workshop-scheduler-block", workshopRawStatusSurfaceClass(job.rawStatus)];
  if (isOverdueJob(job, todayKey, timeZone)) {
    classes.push("workshop-scheduler-block--overdue");
  }

  return classes.join(" ");
};

export const WorkshopSchedulerScreen = ({
  embedded = false,
  refreshToken = 0,
  showToolbar = !embedded,
  title,
  description,
  backLinkTo = embedded ? null : "/workshop",
  view: controlledView,
  anchorDateKey: controlledAnchorDateKey,
  onChangeView,
  onChangeAnchorDateKey,
  technicianId,
  onTechnicianIdChange,
  visibleJobIds,
  requestedOverlayJobId,
  onRequestedOverlayJobHandled,
}: WorkshopSchedulerScreenProps) => {
  const { success, error } = useToasts();
  const [searchParams, setSearchParams] = useSearchParams();
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [overlayJobId, setOverlayJobId] = useState<string | null>(null);
  const [overlaySummary, setOverlaySummary] = useState<WorkshopJobOverlaySummary | null>(null);
  const [internalTechnicianId, setInternalTechnicianId] = useState("");
  const [draft, setDraft] = useState<ScheduleDraft>({
    staffId: "",
    dateKey: "",
    startTime: "",
    durationMinutes: "60",
  });
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragSavingJobId, setDragSavingJobId] = useState<string | null>(null);
  const dayTrackRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickJobIdRef = useRef<string | null>(null);

  const updateDragState = (nextState: DragState | null) => {
    dragStateRef.current = nextState;
    setDragState(nextState);
  };

  const standaloneView = searchParams.get("view") === "day" ? "day" : "week";
  const standaloneAnchorDateKey = searchParams.get("date") || workshopTodayDateKey();
  const view = controlledView ?? standaloneView;
  const anchorDateKey = controlledAnchorDateKey ?? standaloneAnchorDateKey;
  const selectedTechnicianId = technicianId ?? internalTechnicianId;
  const requestedRange = useMemo(() => buildVisibleRange(anchorDateKey, view), [anchorDateKey, view]);
  const calendarTimeZone = calendar?.range.timeZone;
  const todayKey = getDateKeyInTimeZone(new Date(), calendarTimeZone) || workshopTodayDateKey();

  const updateSearchParams = (updates: Record<string, string | null>) => {
    const nextParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (!value) {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }
    });
    setSearchParams(nextParams);
  };

  const changeView = (nextView: CalendarViewMode) => {
    if (onChangeView) {
      onChangeView(nextView);
      return;
    }

    updateSearchParams({ view: nextView });
  };

  const changeAnchorDateKey = (nextDateKey: string) => {
    if (onChangeAnchorDateKey) {
      onChangeAnchorDateKey(nextDateKey);
      return;
    }

    updateSearchParams({ date: nextDateKey });
  };

  const changeTechnicianId = (nextTechnicianId: string) => {
    if (onTechnicianIdChange) {
      onTechnicianIdChange(nextTechnicianId);
      return;
    }

    setInternalTechnicianId(nextTechnicianId);
  };

  const loadCalendar = async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const payload = await apiGet<CalendarResponse>(
        `/api/workshop/calendar?from=${encodeURIComponent(requestedRange.from)}&to=${encodeURIComponent(requestedRange.to)}`,
      );
      setCalendar(payload);
    } catch (loadCalendarError) {
      const message = loadCalendarError instanceof Error
        ? loadCalendarError.message
        : "Failed to load workshop calendar";
      setCalendar(null);
      setLoadError(message);
      error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedRange.from, requestedRange.to, refreshToken]);

  const days = calendar?.days ?? [];
  const daysByDateKey = useMemo(
    () => new Map(days.map((day) => [day.date, day])),
    [days],
  );
  const timeline = useMemo(() => buildTimelineRange(days), [days]);
  const timeLabels = useMemo(() => toTimeLabels(timeline), [timeline]);
  const trackHeight = Math.max(660, timeline.totalMinutes * PX_PER_MINUTE);
  const dayColumnWidth = view === "week" ? WEEK_DAY_WIDTH : DAY_VIEW_WIDTH;
  const scheduledJobs = calendar?.scheduledJobs ?? [];
  const unassignedJobs = calendar?.unassignedJobs ?? [];
  const unscheduledJobs = calendar?.unscheduledJobs ?? [];
  const filteredScheduledJobs = useMemo(
    () => (!visibleJobIds ? scheduledJobs : scheduledJobs.filter((job) => visibleJobIds.has(job.id))),
    [scheduledJobs, visibleJobIds],
  );
  const filteredUnassignedJobs = useMemo(
    () => (!visibleJobIds ? unassignedJobs : unassignedJobs.filter((job) => visibleJobIds.has(job.id))),
    [unassignedJobs, visibleJobIds],
  );
  const filteredUnscheduledJobs = useMemo(
    () => (!visibleJobIds ? unscheduledJobs : unscheduledJobs.filter((job) => visibleJobIds.has(job.id))),
    [unscheduledJobs, visibleJobIds],
  );
  const allJobsById = useMemo(() => {
    const entries = [...filteredScheduledJobs, ...filteredUnassignedJobs, ...filteredUnscheduledJobs];
    return new Map(entries.map((job) => [job.id, job]));
  }, [filteredScheduledJobs, filteredUnassignedJobs, filteredUnscheduledJobs]);
  const selectedJob = selectedJobId ? allJobsById.get(selectedJobId) ?? null : null;

  useEffect(() => {
    if (!selectedJobId) {
      return;
    }

    if (!allJobsById.has(selectedJobId)) {
      setSelectedJobId(null);
      setScheduleError(null);
    }
  }, [allJobsById, selectedJobId]);

  useEffect(() => {
    if (!requestedOverlayJobId) {
      return;
    }

    const requestedJob = allJobsById.get(requestedOverlayJobId) ?? null;
    if (!requestedJob) {
      return;
    }

    setSelectedJobId(null);
    setScheduleError(null);
    setOverlaySummary(toOverlaySummary(requestedJob));
    setOverlayJobId(requestedOverlayJobId);
    onRequestedOverlayJobHandled?.();
  }, [allJobsById, onRequestedOverlayJobHandled, requestedOverlayJobId]);

  useEffect(() => {
    if (selectedTechnicianId && !(calendar?.staff ?? []).some((staff) => staff.id === selectedTechnicianId)) {
      changeTechnicianId("");
    }
  }, [calendar?.staff, selectedTechnicianId]);

  const visibleScheduledJobs = useMemo(
    () => (
      selectedTechnicianId
        ? filteredScheduledJobs.filter((job) => job.assignedStaffId === selectedTechnicianId)
        : filteredScheduledJobs
    ),
    [filteredScheduledJobs, selectedTechnicianId],
  );

  const jobsByDay = useMemo(() => {
    const next = new Map<string, CalendarJob[]>();
    days.forEach((day) => {
      next.set(day.date, []);
    });

    visibleScheduledJobs.forEach((job) => {
      const dateKey = getJobOperationalDateKey(job, calendarTimeZone);
      if (!dateKey || !next.has(dateKey)) {
        return;
      }
      next.get(dateKey)?.push(job);
    });

    return next;
  }, [days, visibleScheduledJobs]);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const getDayTrackTarget = (clientX: number) => {
      for (const day of days) {
        const track = dayTrackRefs.current[day.date];
        if (!track) {
          continue;
        }

        const rect = track.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right) {
          return {
            dateKey: day.date,
            track,
          };
        }
      }

      return null;
    };

    const handlePointerMove = (event: PointerEvent) => {
      const current = dragStateRef.current;
      if (!current || event.pointerId !== current.pointerId) {
        return;
      }

      const target =
        current.source === "queue"
          ? getDayTrackTarget(event.clientX)
          : current.dateKey
            ? {
                dateKey: current.dateKey,
                track: dayTrackRefs.current[current.dateKey],
              }
            : null;
      const track = target?.track;
      const nextDateKey = target?.dateKey ?? null;
      const nextActive = current.active
        || Math.max(
          Math.abs(event.clientX - current.startClientX),
          Math.abs(event.clientY - current.startClientY),
        ) >= DRAG_START_THRESHOLD_PX;

      if (!nextActive && !track) {
        return;
      }

      if (!track || !nextDateKey) {
        updateDragState({
          ...current,
          active: nextActive,
          dateKey: null,
        });

        if (nextActive) {
          event.preventDefault();
        }
        return;
      }

      const relativeTop = event.clientY - track.getBoundingClientRect().top - current.pointerOffsetY;
      const rawMinutes = timeline.openMinutes + (relativeTop / PX_PER_MINUTE);
      const maxStartMinutes = Math.max(timeline.openMinutes, timeline.closeMinutes - current.durationMinutes);
      const snappedStartMinutes = clamp(
        snapMinutesToGrid(rawMinutes, DRAG_SNAP_MINUTES),
        timeline.openMinutes,
        maxStartMinutes,
      );
      const previewPosition = buildPreviewPosition({
        job: current.job,
        jobs: jobsByDay.get(nextDateKey) ?? [],
        dateKey: nextDateKey,
        startMinutes: snappedStartMinutes,
        durationMinutes: current.durationMinutes,
        openMinutes: timeline.openMinutes,
        closeMinutes: timeline.closeMinutes,
        columnWidth: dayColumnWidth,
        timeZone: calendarTimeZone,
      });
      const nextTop =
        previewPosition?.top
        ?? ((snappedStartMinutes - timeline.openMinutes) * PX_PER_MINUTE);
      const nextLeft = previewPosition?.left ?? 0;
      const nextWidth = previewPosition?.width ?? dayColumnWidth;
      const nextHeight =
        previewPosition?.height
        ?? Math.max(MIN_BOOKING_BLOCK_HEIGHT, current.durationMinutes * PX_PER_MINUTE);

      if (
        !nextActive
        && nextTop === current.currentTop
        && nextLeft === current.left
        && nextWidth === current.width
        && nextHeight === current.height
      ) {
        return;
      }

      updateDragState({
        ...current,
        active: nextActive,
        dateKey: nextDateKey,
        left: nextLeft,
        width: nextWidth,
        height: nextHeight,
        currentTop: nextTop,
        snappedStartMinutes,
      });

      if (nextActive) {
        event.preventDefault();
      }
    };

    const finishDrag = (event: PointerEvent, cancelled: boolean) => {
      const current = dragStateRef.current;
      if (!current || event.pointerId !== current.pointerId) {
        return;
      }

      updateDragState(null);

      if (cancelled || !current.active) {
        return;
      }

      if (!current.dateKey) {
        error("Drop the job onto a visible day column to create a timed booking.");
        return;
      }

      if (current.source === "calendar") {
        suppressClickJobIdRef.current = current.job.id;
      }
      void persistDraggedSchedule(current);
    };

    const handlePointerUp = (event: PointerEvent) => finishDrag(event, false);
    const handlePointerCancel = (event: PointerEvent) => finishDrag(event, true);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [calendarTimeZone, dayColumnWidth, days, dragState, error, jobsByDay, timeline.closeMinutes, timeline.openMinutes]);

  const positionedJobsByDay = useMemo(() => {
    const next = new Map<string, PositionedJob[]>();
    days.forEach((day) => {
      next.set(
        day.date,
        toPositionedJobs(
          jobsByDay.get(day.date) ?? [],
          timeline.openMinutes,
          timeline.closeMinutes,
          dayColumnWidth,
          calendarTimeZone,
        ),
      );
    });
    return next;
  }, [calendarTimeZone, dayColumnWidth, days, jobsByDay, timeline.closeMinutes, timeline.openMinutes]);

  const workshopTimeOffByDay = useMemo(() => {
    const next = new Map<string, TimeOffBlock[]>();
    days.forEach((day) => {
      const applicableEntries = (calendar?.workshopTimeOff ?? []).filter((entry) => {
        if (entry.scope === "WORKSHOP") {
          return true;
        }
        return selectedTechnicianId ? entry.staffId === selectedTechnicianId : false;
      });

      next.set(
        day.date,
        getWorkshopTimeOffBlocksForDay(
          applicableEntries,
          day.date,
          timeline.openMinutes,
          timeline.closeMinutes,
          calendarTimeZone,
        ),
      );
    });
    return next;
  }, [calendar?.workshopTimeOff, calendarTimeZone, days, selectedTechnicianId, timeline.closeMinutes, timeline.openMinutes]);

  const staffCount = calendar?.staff.length ?? 0;
  const staffFilterOptions = calendar?.staff ?? [];
  const selectedTechnician = staffFilterOptions.find((staff) => staff.id === selectedTechnicianId) ?? null;
  const overlayTechnicianOptions = useMemo<WorkshopOverlayTechnicianOption[]>(
    () => staffFilterOptions.map((staff) => ({ id: staff.id, name: staff.name })),
    [staffFilterOptions],
  );

  const openEditor = (job: CalendarJob, preferredDateKey?: string) => {
    const editorDateKey = preferredDateKey || getJobOperationalDateKey(job, calendarTimeZone) || anchorDateKey;
    setSelectedJobId(job.id);
    setDraft(buildInitialDraft(job, editorDateKey, daysByDateKey.get(editorDateKey), calendarTimeZone));
    setScheduleError(null);
  };

  const closeEditor = () => {
    setSelectedJobId(null);
    setScheduleError(null);
  };

  const openJobOverlay = (job: CalendarJob) => {
    setSelectedJobId(null);
    setScheduleError(null);
    setOverlaySummary(toOverlaySummary(job));
    setOverlayJobId(job.id);
  };

  const closeJobOverlay = () => {
    setOverlaySummary(null);
    setOverlayJobId(null);
  };

  const selectedOverlayJob = overlayJobId ? allJobsById.get(overlayJobId) ?? null : null;
  const selectedOverlaySummary: WorkshopJobOverlaySummary | null = selectedOverlayJob
    ? toOverlaySummary(selectedOverlayJob)
    : overlaySummary;

  const persistDraggedSchedule = async (state: DragState) => {
    if (!state.dateKey) {
      error("Could not calculate a workshop day for this drop.");
      return;
    }

    const startTimeValue = formatClockLabel(state.snappedStartMinutes);
    const scheduledStartAt = buildScheduleIso(state.dateKey, startTimeValue);
    if (!scheduledStartAt) {
      error("Could not calculate the dropped booking time.");
      return;
    }

    setDragSavingJobId(state.job.id);
    setScheduleError(null);

    try {
      const response = await apiPatch<SchedulePatchResponse>(
        `/api/workshop/jobs/${encodeURIComponent(state.job.id)}/schedule`,
        {
          staffId: state.staffId,
          scheduledStartAt,
          durationMinutes: state.durationMinutes,
        },
      );

      if (selectedJobId === state.job.id) {
        setDraft((current) => ({
          ...current,
          dateKey: state.dateKey,
          staffId: state.staffId || "",
          startTime: startTimeValue,
          durationMinutes: `${state.durationMinutes}`,
        }));
      }

      const assignedStaffName = state.staffId
        ? staffFilterOptions.find((staff) => staff.id === state.staffId)?.name ?? null
        : null;
      const timeLabel = buildBlockTimeLabel(state.snappedStartMinutes, state.durationMinutes);
      const placementLabel = assignedStaffName ? `${timeLabel} with ${assignedStaffName}` : timeLabel;

      success(
        response.idempotent
          ? `Booking already matched ${placementLabel}.`
          : state.source === "queue"
            ? `Scheduled for ${placementLabel}.`
            : `Booking moved to ${placementLabel}.`,
      );
      await loadCalendar();
    } catch (dragError) {
      const message = dragError instanceof Error ? dragError.message : "Failed to update workshop schedule";
      setScheduleError(message);
      error(message);
    } finally {
      setDragSavingJobId(null);
    }
  };

  const handleJobBlockPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    job: CalendarJob,
    dateKey: string,
    top: number,
    height: number,
    left: number,
    width: number,
  ) => {
    if (event.button !== 0 || saving || Boolean(dragSavingJobId)) {
      return;
    }

    const durationMinutes = getScheduledDurationMinutes(job, calendarTimeZone);
    const startMinutes = getMinutesInTimeZone(job.scheduledStartAt, calendarTimeZone);
    if (!durationMinutes || startMinutes === null) {
      return;
    }

    const blockRect = event.currentTarget.getBoundingClientRect();
    updateDragState({
      source: "calendar",
      pointerId: event.pointerId,
      job,
      dateKey,
      staffId: job.assignedStaffId || null,
      left,
      width,
      height,
      pointerOffsetY: event.clientY - blockRect.top,
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentTop: top,
      snappedStartMinutes: startMinutes,
      durationMinutes,
      active: false,
    });
  };

  const handleQueueJobPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    job: CalendarJob,
  ) => {
    const target = event.target as HTMLElement | null;
    if (
      event.button !== 0
      || saving
      || Boolean(dragSavingJobId)
      || target?.closest("button, a, input, select, textarea")
    ) {
      return;
    }

    const durationMinutes = getScheduledDurationMinutes(job, calendarTimeZone);
    const previewHeight = Math.max(MIN_BOOKING_BLOCK_HEIGHT, durationMinutes * PX_PER_MINUTE);

    event.preventDefault();

    updateDragState({
      source: "queue",
      pointerId: event.pointerId,
      job,
      dateKey: null,
      staffId: selectedTechnicianId || null,
      left: 0,
      width: dayColumnWidth,
      height: previewHeight,
      pointerOffsetY: clamp(previewHeight / 2, 16, Math.max(16, previewHeight - 16)),
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentTop: 0,
      snappedStartMinutes: timeline.openMinutes,
      durationMinutes,
      active: false,
    });
  };

  const handleJobBlockClick = (job: CalendarJob) => {
    if (suppressClickJobIdRef.current === job.id) {
      suppressClickJobIdRef.current = null;
      return;
    }

    openJobOverlay(job);
  };

  const saveSchedule = async () => {
    if (!selectedJob) {
      return;
    }

    const scheduledStartAt = buildScheduleIso(draft.dateKey, draft.startTime);
    const durationMinutes = Number(draft.durationMinutes);

    if (!draft.dateKey) {
      setScheduleError("Choose a valid calendar date.");
      return;
    }
    if (!scheduledStartAt) {
      setScheduleError("Choose a valid start time.");
      return;
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      setScheduleError("Duration must be a positive whole number of minutes.");
      return;
    }

    setSaving(true);
    setScheduleError(null);

    try {
      const response = await apiPatch<SchedulePatchResponse>(
        `/api/workshop/jobs/${encodeURIComponent(selectedJob.id)}/schedule`,
        {
          staffId: draft.staffId || null,
          scheduledStartAt,
          durationMinutes,
        },
      );

      success(response.idempotent ? "Schedule already matches." : "Workshop schedule updated.");
      await loadCalendar();
      closeEditor();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to update workshop schedule";
      setScheduleError(message);
      error(message);
    } finally {
      setSaving(false);
    }
  };

  const clearSchedule = async () => {
    if (!selectedJob) {
      return;
    }

    setSaving(true);
    setScheduleError(null);

    try {
      const response = await apiPatch<SchedulePatchResponse>(
        `/api/workshop/jobs/${encodeURIComponent(selectedJob.id)}/schedule`,
        {
          clearSchedule: true,
        },
      );

      success(response.idempotent ? "Timed schedule already cleared." : "Timed schedule cleared.");
      await loadCalendar();
      closeEditor();
    } catch (clearError) {
      const message = clearError instanceof Error ? clearError.message : "Failed to clear timed schedule";
      setScheduleError(message);
      error(message);
    } finally {
      setSaving(false);
    }
  };

  const toolbarLeadingAction: ReactNode = backLinkTo ? (
    <Link to={backLinkTo} className="button-link">Back to Operating System</Link>
  ) : null;

  return (
    <div className={embedded ? "workshop-scheduler-screen workshop-scheduler-screen--embedded" : "page-shell page-shell-workspace workshop-scheduler-page"}>
      {showToolbar ? (
        <section className={embedded ? "workshop-scheduler-toolbar workshop-scheduler-toolbar--embedded" : "card workshop-scheduler-toolbar"}>
          <div className="card-header-row">
            <div>
              <h1>{title || (embedded ? "Scheduler" : "Workshop Calendar")}</h1>
              <p className="muted-text">
                {description || (
                  embedded
                    ? "Week-first timed scheduling is now the main workshop surface, with day detail on demand and booking blocks rendered directly in the grid."
                    : "Timed workshop scheduler with week view first, day detail on demand, and bookings rendered as real calendar blocks instead of staffing rows."
                )}
              </p>
            </div>
            <div className="actions-inline">
              {toolbarLeadingAction}
              <button type="button" onClick={() => void loadCalendar()} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="workshop-scheduler-toolbar__controls">
            <div className="workshop-scheduler-toolbar__view-toggle" role="tablist" aria-label="Calendar view mode">
              <button
                type="button"
                role="tab"
                aria-selected={view === "week"}
                className={view === "week" ? "primary" : ""}
                onClick={() => changeView("week")}
              >
                Week
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "day"}
                className={view === "day" ? "primary" : ""}
                onClick={() => changeView("day")}
              >
                Day
              </button>
            </div>

            <div className="actions-inline">
              <button
                type="button"
                onClick={() => changeAnchorDateKey(shiftWorkshopAnchorDateKey(anchorDateKey, view, -1))}
              >
                {view === "week" ? "Previous Week" : "Previous Day"}
              </button>
              <button
                type="button"
                onClick={() => changeAnchorDateKey(workshopTodayDateKey())}
                disabled={anchorDateKey === todayKey}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => changeAnchorDateKey(shiftWorkshopAnchorDateKey(anchorDateKey, view, 1))}
              >
                {view === "week" ? "Next Week" : "Next Day"}
              </button>
            </div>

            <label className="workshop-scheduler-toolbar__filter">
              Technician
              <select
                value={selectedTechnicianId}
                onChange={(event) => changeTechnicianId(event.target.value)}
              >
                <option value="">All technicians</option>
                {staffFilterOptions.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="workshop-scheduler-toolbar__summary">
            <article className="metric-card">
              <span className="metric-label">Visible range</span>
              <strong className="metric-value">{formatRangeHeading(days, view)}</strong>
              <span className="dashboard-metric-detail">
                {days.length ? `${days[0].date} - ${days[days.length - 1].date}` : anchorDateKey}
              </span>
            </article>
            <article className="metric-card">
              <span className="metric-label">Timed bookings</span>
              <strong className="metric-value">{visibleScheduledJobs.length}</strong>
              <span className="dashboard-metric-detail">
                {filteredUnassignedJobs.length} unassigned · {filteredUnscheduledJobs.length} still need a slot
              </span>
            </article>
            <article className="metric-card">
              <span className="metric-label">Technician context</span>
              <strong className="metric-value">{selectedTechnician?.name || `${staffCount} staff`}</strong>
              <span className="dashboard-metric-detail">
                {selectedTechnician
                  ? "Showing this technician's timed bookings"
                  : "Showing all scheduled workshop work"}
              </span>
            </article>
          </div>
        </section>
      ) : null}

      {loadError ? (
        <section className="restricted-panel warning-panel">
          {loadError}
        </section>
      ) : null}

      <div className={embedded ? "workshop-scheduler-layout workshop-scheduler-layout--embedded" : "workshop-scheduler-layout"}>
        <section className={`${embedded ? "workshop-scheduler-board workshop-scheduler-board--embedded" : "card workshop-scheduler-board"}${dragState?.source === "queue" && dragState.active ? " workshop-scheduler-board--queue-dragging" : ""}`}>
          <div className="workshop-scheduler-board__header">
            <div>
              <h2>{view === "week" ? "Week schedule" : "Day schedule"}</h2>
              <p className="muted-text">
                Scheduled jobs render as timed blocks in the grid. Pick a booking to adjust timing and assignment without leaving the scheduler.
              </p>
            </div>
            <div className="table-secondary">
              {calendar?.range.timeZone || "Local"} time
            </div>
          </div>

          <div className="workshop-scheduler-scroll">
            <div
              className="workshop-scheduler-grid"
              style={{ gridTemplateColumns: `88px repeat(${Math.max(days.length, 1)}, ${dayColumnWidth}px)` }}
            >
              <div className="workshop-scheduler-grid__corner">Time</div>

              {days.map((day) => {
                const dayCapacity = toDayCapacitySummary(calendar?.staff ?? [], day.date, selectedTechnicianId);
                const visibleDayJobs = jobsByDay.get(day.date)?.length ?? 0;

                return (
                  <div key={day.date} className="workshop-scheduler-grid__day-header">
                    <strong>{day.weekday}</strong>
                    <span>{formatOptionalDate(`${day.date}T12:00:00.000Z`, calendarTimeZone)}</span>
                    <span>
                      {day.isClosed
                        ? "Closed"
                        : `${day.opensAt || "--:--"} - ${day.closesAt || "--:--"}`}
                    </span>
                    <span>{visibleDayJobs} jobs</span>
                    <span>
                      {dayCapacity.totalMinutes
                        ? `${dayCapacity.bookedMinutes} / ${dayCapacity.totalMinutes} mins booked`
                        : "Capacity unavailable"}
                    </span>
                  </div>
                );
              })}

              <div className="workshop-scheduler-grid__time-axis" style={{ height: `${trackHeight}px` }}>
                {timeLabels.map((minutes) => (
                  <div
                    key={minutes}
                    className="workshop-scheduler-grid__time-label mono-text"
                    style={{ top: `${(minutes - timeline.openMinutes) * PX_PER_MINUTE}px` }}
                  >
                    {formatClockLabel(minutes)}
                  </div>
                ))}
              </div>

              {days.map((day) => {
                const dayBlocks = positionedJobsByDay.get(day.date) ?? [];
                const timeOffBlocks = workshopTimeOffByDay.get(day.date) ?? [];
                const previewBlock = dragState?.active && dragState.dateKey === day.date ? dragState : null;

                return (
                  <div
                    key={`${day.date}-track`}
                    ref={(node) => {
                      dayTrackRefs.current[day.date] = node;
                    }}
                    className={`workshop-scheduler-grid__day-track${day.isClosed ? " workshop-scheduler-grid__day-track--closed" : ""}${previewBlock ? " workshop-scheduler-grid__day-track--drag-active" : ""}`}
                    style={{ height: `${trackHeight}px` }}
                  >
                    {timeLabels.map((minutes) => (
                      <span
                        key={`${day.date}-${minutes}`}
                        className="workshop-scheduler-grid__hour-line"
                        style={{ top: `${(minutes - timeline.openMinutes) * PX_PER_MINUTE}px` }}
                      />
                    ))}

                    {timeOffBlocks.map((entry) => (
                      <div
                        key={entry.id}
                        className={`workshop-scheduler-timeoff workshop-scheduler-timeoff--${entry.scope.toLowerCase()}`}
                        style={{ top: `${entry.top}px`, height: `${entry.height}px` }}
                      >
                        <span>{entry.label}</span>
                      </div>
                    ))}

                    {dayBlocks.map(({ job, top, height, left, width }) => {
                      const isCompactBlock = height < COMPACT_BOOKING_BLOCK_HEIGHT;
                      const isDragging = dragState?.active && dragState.job.id === job.id;
                      const toneClass = `${buildJobToneClass(job, todayKey, calendarTimeZone)}${selectedJobId === job.id ? " workshop-scheduler-block--selected" : ""}${isCompactBlock ? " workshop-scheduler-block--compact" : ""}${isDragging ? " workshop-scheduler-block--dragging" : ""}`;

                      return (
                        <button
                          key={job.id}
                          type="button"
                          className={toneClass}
                          title={getBookingTooltip(job, calendarTimeZone)}
                          style={{
                            top: `${top}px`,
                            left: `${left}px`,
                            width: `${width}px`,
                            height: `${height}px`,
                          }}
                          onPointerDown={(event) => handleJobBlockPointerDown(event, job, day.date, top, height, left, width)}
                          onClick={() => handleJobBlockClick(job)}
                          disabled={saving || dragSavingJobId === job.id}
                        >
                          {renderSchedulerBlockContent({
                            job,
                            timeLabel: `${formatOptionalTime(job.scheduledStartAt, calendarTimeZone)} - ${formatOptionalTime(job.scheduledEndAt, calendarTimeZone)}`,
                            metaLabel: getBookingMetaLine(job, todayKey, calendarTimeZone),
                            isCompactBlock,
                          })}
                        </button>
                      );
                    })}

                    {previewBlock ? (
                      <div
                        aria-hidden="true"
                        className={`${buildJobToneClass(previewBlock.job, todayKey, calendarTimeZone)} workshop-scheduler-block--drag-preview${previewBlock.height < COMPACT_BOOKING_BLOCK_HEIGHT ? " workshop-scheduler-block--compact" : ""}`}
                        style={{
                          top: `${previewBlock.currentTop}px`,
                          left: `${previewBlock.left}px`,
                          width: `${previewBlock.width}px`,
                          height: `${previewBlock.height}px`,
                        }}
                      >
                        {renderSchedulerBlockContent({
                          job: previewBlock.job,
                          timeLabel: buildBlockTimeLabel(previewBlock.snappedStartMinutes, previewBlock.durationMinutes),
                          metaLabel: previewBlock.source === "queue"
                            ? `Drop to schedule${previewBlock.staffId && selectedTechnician ? ` with ${selectedTechnician.name}` : ""} at ${formatClockLabel(previewBlock.snappedStartMinutes)}`
                            : `Drop to move this booking to ${formatClockLabel(previewBlock.snappedStartMinutes)}`,
                          isCompactBlock: previewBlock.height < COMPACT_BOOKING_BLOCK_HEIGHT,
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside className={embedded ? "workshop-scheduler-rail workshop-scheduler-rail--embedded" : "workshop-scheduler-rail"}>
          <section className={embedded ? "workshop-scheduler-panel workshop-scheduler-panel--embedded" : "card workshop-scheduler-panel"}>
            <div className="card-header-row">
              <div>
                <h2>{selectedJob ? "Booking editor" : "Booking details"}</h2>
                <p className="muted-text">
                  {selectedJob
                    ? "Adjust the selected workshop booking without leaving the schedule."
                    : "Pick a booking block or queue item to schedule it."}
                </p>
              </div>
              {selectedJob ? (
                <button type="button" onClick={closeEditor} disabled={saving}>
                  Close
                </button>
              ) : null}
            </div>

            {selectedJob ? (
              <div className="workshop-scheduler-editor">
                <div className="workshop-scheduler-editor__summary">
                  <strong>{getJobHeading(selectedJob)}</strong>
                  <span className={workshopRawStatusClass(selectedJob.rawStatus)}>
                    {workshopRawStatusLabel(selectedJob.rawStatus)}
                  </span>
                  <div className="table-secondary">{getJobSubline(selectedJob)}</div>
                </div>

                <label>
                  Date
                  <input
                    type="date"
                    value={draft.dateKey}
                    onChange={(event) => setDraft((current) => ({ ...current, dateKey: event.target.value }))}
                    disabled={saving}
                  />
                </label>

                <label>
                  Technician
                  <select
                    value={draft.staffId}
                    onChange={(event) => setDraft((current) => ({ ...current, staffId: event.target.value }))}
                    disabled={saving}
                  >
                    <option value="">Leave unassigned</option>
                    {staffFilterOptions.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="job-meta-grid">
                  <label>
                    Start time
                    <input
                      type="time"
                      value={draft.startTime}
                      onChange={(event) => setDraft((current) => ({ ...current, startTime: event.target.value }))}
                      disabled={saving}
                    />
                  </label>
                  <label>
                    Duration (minutes)
                    <input
                      type="number"
                      min={15}
                      step={15}
                      value={draft.durationMinutes}
                      list="workshop-scheduler-duration-presets"
                      onChange={(event) => setDraft((current) => ({ ...current, durationMinutes: event.target.value }))}
                      disabled={saving}
                    />
                    <datalist id="workshop-scheduler-duration-presets">
                      {DURATION_PRESETS.map((value) => (
                        <option key={value} value={value} />
                      ))}
                    </datalist>
                  </label>
                </div>

                {scheduleError ? (
                  <div className="restricted-panel warning-panel">
                    {scheduleError}
                  </div>
                ) : null}

                <div className="actions-inline">
                  <button type="button" className="primary" onClick={() => void saveSchedule()} disabled={saving}>
                    {saving ? "Saving..." : selectedJob.scheduledStartAt ? "Save booking" : "Schedule job"}
                  </button>
                  {selectedJob.scheduledStartAt ? (
                    <button type="button" onClick={() => void clearSchedule()} disabled={saving}>
                      Clear slot
                    </button>
                  ) : null}
                  <button type="button" onClick={() => openJobOverlay(selectedJob)} disabled={saving}>
                    Open job card
                  </button>
                </div>
              </div>
            ) : (
              <div className="ui-empty-state">
                <strong className="ui-empty-state__title">No booking selected</strong>
                <span className="ui-empty-state__description">
                  Use the week grid as the main scheduler, then fine-tune a job here.
                </span>
              </div>
            )}
          </section>

          <section className={embedded ? "workshop-scheduler-panel workshop-scheduler-panel--embedded" : "card workshop-scheduler-panel"}>
            <div className="card-header-row">
              <div>
                <h2>Needs scheduling</h2>
                <p className="muted-text">Drag a job into the calendar to place its first timed slot, or open it to schedule manually.</p>
              </div>
              <span className="stock-badge stock-muted">{filteredUnscheduledJobs.length}</span>
            </div>

            <div className="workshop-scheduler-queue">
              {filteredUnscheduledJobs.length === 0 ? (
                <div className="workshop-scheduler-empty">No jobs are waiting for a first timed slot.</div>
              ) : filteredUnscheduledJobs.map((job) => (
                <article
                  key={job.id}
                  className={`workshop-scheduler-queue-card workshop-scheduler-queue-card--draggable ${workshopRawStatusSurfaceClass(job.rawStatus)}${dragState?.source === "queue" && dragState.active && dragState.job.id === job.id ? " workshop-scheduler-queue-card--dragging" : ""}`}
                  onPointerDown={(event) => handleQueueJobPointerDown(event, job)}
                >
                  <div>
                    <strong>{getJobHeading(job)}</strong>
                    <div className="table-secondary">{job.customerName || "Customer pending"}</div>
                    <div className="table-secondary">
                      Promise date: {job.scheduledDate ? formatPromiseDate(job.scheduledDate) : "Not set"}
                    </div>
                    <div>
                      <span className={workshopRawStatusClass(job.rawStatus)}>
                        {workshopRawStatusLabel(job.rawStatus)}
                      </span>
                    </div>
                  </div>
                  <div className="actions-inline">
                    <button type="button" onClick={() => openEditor(job, anchorDateKey)}>Schedule</button>
                    <button type="button" onClick={() => openJobOverlay(job)}>Open</button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={embedded ? "workshop-scheduler-panel workshop-scheduler-panel--embedded" : "card workshop-scheduler-panel"}>
            <div className="card-header-row">
              <div>
                <h2>Timed but unassigned</h2>
                <p className="muted-text">Timed jobs that still need a named technician.</p>
              </div>
              <span className="stock-badge stock-muted">{filteredUnassignedJobs.length}</span>
            </div>

            <div className="workshop-scheduler-queue">
              {filteredUnassignedJobs.length === 0 ? (
                <div className="workshop-scheduler-empty">Every timed booking is assigned to a technician.</div>
              ) : filteredUnassignedJobs.map((job) => (
                <article
                  key={job.id}
                  className={`workshop-scheduler-queue-card ${workshopRawStatusSurfaceClass(job.rawStatus)}`}
                >
                  <div>
                    <strong>{getJobHeading(job)}</strong>
                    <div className="table-secondary">
                      Scheduled {formatOptionalDate(job.scheduledStartAt, calendarTimeZone)} · {formatOptionalTime(job.scheduledStartAt, calendarTimeZone)}
                    </div>
                    <div className="table-secondary">{job.customerName || workshopRawStatusLabel(job.rawStatus)}</div>
                    <div>
                      <span className={workshopRawStatusClass(job.rawStatus)}>
                        {workshopRawStatusLabel(job.rawStatus)}
                      </span>
                    </div>
                  </div>
                  <div className="actions-inline">
                    <button type="button" onClick={() => openEditor(job, getJobOperationalDateKey(job, calendarTimeZone) || anchorDateKey)}>Assign</button>
                    <button type="button" onClick={() => openJobOverlay(job)}>Open</button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {(calendar?.workshopTimeOff.length ?? 0) > 0 ? (
            <section className={embedded ? "workshop-scheduler-panel workshop-scheduler-panel--embedded" : "card workshop-scheduler-panel"}>
              <div className="card-header-row">
                <div>
                  <h2>Time-off blocks</h2>
                  <p className="muted-text">
                    Workshop-wide closures and{selectedTechnician ? ` ${selectedTechnician.name}'s` : " selected technician"} blocked time.
                  </p>
                </div>
              </div>

              <div className="workshop-scheduler-queue">
                {calendar?.workshopTimeOff
                  .filter((entry) => entry.scope === "WORKSHOP" || (selectedTechnicianId && entry.staffId === selectedTechnicianId))
                  .map((entry) => (
                    <article key={entry.id} className="workshop-scheduler-queue-card">
                      <div>
                        <strong>{entry.reason || (entry.scope === "WORKSHOP" ? "Workshop block" : "Staff time off")}</strong>
                        <div className="table-secondary">
                          {formatOptionalDate(entry.startAt, calendarTimeZone)} · {formatOptionalTime(entry.startAt, calendarTimeZone)} - {formatOptionalTime(entry.endAt, calendarTimeZone)}
                        </div>
                      </div>
                    </article>
                  ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      {overlayJobId ? (
        <WorkshopJobOverlay
          jobId={overlayJobId}
          summary={selectedOverlaySummary}
          fullJobPath={selectedOverlayJob?.jobPath || `/workshop/${overlayJobId}`}
          technicianOptions={overlayTechnicianOptions}
          timeZone={calendarTimeZone}
          onJobChanged={loadCalendar}
          onClose={closeJobOverlay}
        />
      ) : null}
    </div>
  );
};

export const WorkshopCalendarPage = () => <WorkshopSchedulerScreen />;
