import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { WorkshopJobOverlay, type WorkshopJobOverlaySummary } from "../features/workshop/WorkshopJobOverlay";
import {
  getWorkshopDisplayStatus,
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
  isTechnician: boolean;
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
  weekRangeMode?: "calendar" | "operational" | "standalone";
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

type PositionedJob = {
  job: CalendarJob;
  top: number;
  height: number;
  left: number;
  width: number;
};

type QueuePlacementKind = "unscheduled" | "unassigned";
type SchedulerInteractionMode = "move" | "resize-top" | "resize-bottom";
type SchedulerBlockDensity = "minimal" | "compact" | "full";
type SchedulerZoomLevel = "compact" | "standard" | "comfortable";

type PlacementState = {
  source: "calendar" | "queue";
  interaction: SchedulerInteractionMode;
  queueKind: QueuePlacementKind | null;
  job: CalendarJob;
  dateKey: string | null;
  staffId: string | null;
  left: number;
  width: number;
  height: number;
  currentTop: number;
  snappedStartMinutes: number;
  durationMinutes: number;
  fixedBoundaryMinutes: number | null;
};

type DragState = PlacementState & {
  pointerId: number;
  pointerOffsetY: number;
  startClientX: number;
  startClientY: number;
  active: boolean;
};

type PendingTechnicianPromptState = PlacementState & {
  source: "queue";
  queueKind: "unassigned";
  dateKey: string;
};

type PendingTechnicianPickerLayout = {
  top: number;
  left: number;
  maxHeight: number;
};

type TimeOffBlock = {
  id: string;
  top: number;
  height: number;
  scope: "WORKSHOP" | "STAFF";
  label: string;
};

type SchedulerLayoutEntry = {
  job: CalendarJob;
  startMinutes: number;
  endMinutes: number;
  clippedStart: number;
  clippedEnd: number;
};

type SchedulerCollisionGroup = {
  entries: SchedulerLayoutEntry[];
  maxEndMinutes: number;
};

type SchedulerLaneState = {
  endMinutes: number;
};

const DEFAULT_OPEN_MINUTES = 9 * 60;
const DEFAULT_CLOSE_MINUTES = 18 * 60;
const TIME_AXIS_WIDTH = 60;
const WEEK_DAY_WIDTH = 118;
const STANDALONE_WEEK_DAY_WIDTH = 98;
const DAY_VIEW_WIDTH = 460;
const JOB_BLOCK_GAP = 6;
const MINIMAL_BOOKING_BLOCK_HEIGHT = 64;
const COMPACT_BOOKING_BLOCK_HEIGHT = 96;
const DURATION_PRESETS = [30, 45, 60, 90, 120, 180];
const DRAG_SNAP_MINUTES = 15;
const MIN_SCHEDULE_DURATION_MINUTES = 15;
const DRAG_START_THRESHOLD_PX = 6;
const TECHNICIAN_PICKER_WIDTH = 204;
const TECHNICIAN_PICKER_MIN_HEIGHT = 156;
const TECHNICIAN_PICKER_VIEWPORT_GAP = 10;
const MIN_SCHEDULER_TRACK_HEIGHT = 640;
const SCHEDULER_ZOOM_STORAGE_KEY = "corepos:workshop-scheduler-zoom";
const DEFAULT_SCHEDULER_ZOOM_LEVEL: SchedulerZoomLevel = "standard";
const SCHEDULER_ZOOM_OPTIONS: ReadonlyArray<{
  value: SchedulerZoomLevel;
  label: string;
  pxPerMinute: number;
}> = [
  { value: "compact", label: "Compact", pxPerMinute: 1.2 },
  { value: "standard", label: "Standard", pxPerMinute: 1.5 },
  { value: "comfortable", label: "Comfortable", pxPerMinute: 1.9 },
];

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const isSchedulerZoomLevel = (value: string): value is SchedulerZoomLevel =>
  SCHEDULER_ZOOM_OPTIONS.some((option) => option.value === value);

const readStoredSchedulerZoomLevel = (): SchedulerZoomLevel => {
  if (!isBrowser()) {
    return DEFAULT_SCHEDULER_ZOOM_LEVEL;
  }

  try {
    const stored = window.localStorage.getItem(SCHEDULER_ZOOM_STORAGE_KEY);
    return stored && isSchedulerZoomLevel(stored) ? stored : DEFAULT_SCHEDULER_ZOOM_LEVEL;
  } catch {
    return DEFAULT_SCHEDULER_ZOOM_LEVEL;
  }
};

const persistSchedulerZoomLevel = (value: SchedulerZoomLevel) => {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(SCHEDULER_ZOOM_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures so the scheduler still works in restricted browsers.
  }
};

const getMinimumBookingBlockHeight = (pxPerMinute: number) =>
  Math.max(18, MIN_SCHEDULE_DURATION_MINUTES * pxPerMinute);

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

const clampPickerPosition = (value: number, min: number, max: number) => {
  if (max < min) {
    return min;
  }
  return clamp(value, min, max);
};

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

const formatCompactScheduleMeta = (job: CalendarJob, timeZone: string) => {
  if (!job.scheduledStartAt) {
    return "Schedule pending";
  }

  return `Scheduled ${formatOptionalDate(job.scheduledStartAt, timeZone)} · ${formatOptionalTime(job.scheduledStartAt, timeZone)}`;
};

const getQueueMetaLine = (job: CalendarJob, timeZone: string) => {
  const customerLabel = job.customerName?.trim() || "Customer pending";
  const scheduleLabel = job.scheduledStartAt
    ? formatCompactScheduleMeta(job, timeZone)
    : `Promise ${formatPromiseDate(job.scheduledDate)}`;

  return `${customerLabel} · ${scheduleLabel}`;
};

const getBookingCustomerName = (job: CalendarJob) =>
  job.customerName || "Customer pending";

const getBookingBikeLine = (job: CalendarJob) =>
  job.bikeDescription?.trim() || "Bike details pending";

const getBookingTechnicianLabel = (
  job: CalendarJob,
  overrideName?: string | null,
) => {
  const assignedName = overrideName?.trim() || job.assignedStaffName?.trim();
  return assignedName
    ? {
        label: assignedName,
        assigned: true,
      }
    : {
        label: "Unassigned",
        assigned: false,
      };
};

const getBookingMetaLine = (job: CalendarJob, todayKey: string, timeZone?: string) => {
  if (isOverdueJob(job, todayKey, timeZone)) {
    return "Overdue";
  }

  return workshopRawStatusLabel(job);
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

type SchedulerSignalKey = "approval" | "approved" | "arrived" | "cancelled" | "parts" | "overdue" | "ready";

const SIGNAL_PRIORITY: SchedulerSignalKey[] = ["overdue", "cancelled", "approval", "arrived", "parts", "approved", "ready"];

const buildSchedulerSignals = (
  job: CalendarJob,
  todayKey: string,
  timeZone?: string,
): SchedulerSignalKey[] => {
  const signals = new Set<SchedulerSignalKey>();
  const displayStatus = getWorkshopDisplayStatus(job);

  if (isOverdueJob(job, todayKey, timeZone)) {
    signals.add("overdue");
  }
  if (displayStatus === "WAITING_FOR_PARTS") {
    signals.add("parts");
  }
  if (displayStatus === "WAITING_FOR_APPROVAL") {
    signals.add("approval");
  }
  if (displayStatus === "CANCELLED") {
    signals.add("cancelled");
  }
  if (displayStatus === "BIKE_ARRIVED") {
    signals.add("arrived");
  }
  if (displayStatus === "APPROVED") {
    signals.add("approved");
  }
  if (displayStatus === "BIKE_READY") {
    signals.add("ready");
  }

  return SIGNAL_PRIORITY.filter((signal) => signals.has(signal));
};

const renderSchedulerSignalIcon = (signal: SchedulerSignalKey) => {
  switch (signal) {
    case "approval":
      return (
        <span className="workshop-scheduler-block__signal-glyph" aria-hidden="true">
          ❓
        </span>
      );
    case "approved":
      return (
        <span className="workshop-scheduler-block__signal-glyph" aria-hidden="true">
          £
        </span>
      );
    case "parts":
      return (
        <span className="workshop-scheduler-block__signal-glyph" aria-hidden="true">
          🔧
        </span>
      );
    case "cancelled":
      return (
        <span className="workshop-scheduler-block__signal-glyph" aria-hidden="true">
          ❌
        </span>
      );
    case "arrived":
      return (
        <span className="workshop-scheduler-block__signal-glyph" aria-hidden="true">
          🚲
        </span>
      );
    case "overdue":
      return (
        <span className="workshop-scheduler-block__signal-glyph" aria-hidden="true">
          ⚠
        </span>
      );
    case "ready":
      return (
        <span className="workshop-scheduler-block__signal-glyph" aria-hidden="true">
          ✔
        </span>
      );
    default:
      return null;
  }
};

const schedulerSignalLabel = (signal: SchedulerSignalKey) => {
  switch (signal) {
    case "approval":
      return "Approval needed";
    case "approved":
      return "Approved estimate";
    case "parts":
      return "Waiting for parts";
    case "cancelled":
      return "Cancelled";
    case "arrived":
      return "Bike arrived";
    case "overdue":
      return "Overdue";
    case "ready":
      return "Bike ready";
    default:
      return "";
  }
};

const SchedulerSignals = ({
  signals,
}: {
  signals: SchedulerSignalKey[];
}) => {
  if (signals.length === 0) {
    return null;
  }

  return (
    <span className="workshop-scheduler-block__signals" aria-label={signals.map(schedulerSignalLabel).join(", ")}>
      {signals.map((signal) => (
        <span
          key={signal}
          className={`workshop-scheduler-block__signal workshop-scheduler-block__signal--${signal}`}
          aria-label={schedulerSignalLabel(signal)}
        >
          {renderSchedulerSignalIcon(signal)}
        </span>
      ))}
    </span>
  );
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
  details.push(`Status: ${workshopRawStatusLabel(job)}`);
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
  const displayStatus = getWorkshopDisplayStatus(job);
  return Boolean(
    jobDateKey
      && jobDateKey < todayKey
      && !["COMPLETED", "CANCELLED", "BIKE_READY"].includes(displayStatus ?? ""),
  );
};

const getOperationalWeekStart = (anchor: Date) => {
  const monday = startOfWeek(anchor);
  const weekdayIndex = (anchor.getDay() + 6) % 7;
  if (weekdayIndex <= 2) {
    return monday;
  }
  return addDays(anchor, -2);
};

const getStandaloneWeekStart = (anchor: Date) => addDays(anchor, -2);

const getAnchorDateForVisibleWeekStart = (
  start: Date,
  weekRangeMode: "calendar" | "operational" | "standalone",
) => {
  if (weekRangeMode === "standalone") {
    return addDays(start, 2);
  }

  if (weekRangeMode === "operational") {
    const weekdayIndex = (start.getDay() + 6) % 7;
    return weekdayIndex === 0 ? start : addDays(start, 2);
  }

  return start;
};

const buildVisibleRange = (
  anchorDateKey: string,
  view: CalendarViewMode,
  weekRangeMode: "calendar" | "operational" | "standalone" = "calendar",
) => {
  const anchor = parseDateKey(anchorDateKey);
  const start = view === "week"
    ? (
      weekRangeMode === "operational"
        ? getOperationalWeekStart(anchor)
        : weekRangeMode === "standalone"
          ? getStandaloneWeekStart(anchor)
          : startOfWeek(anchor)
    )
    : anchor;
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

export const shiftWorkshopVisibleWindowDateKey = (
  anchorDateKey: string,
  view: CalendarViewMode,
  weekRangeMode: "calendar" | "operational" | "standalone",
  direction: -1 | 1,
) => {
  if (view !== "week" || weekRangeMode === "calendar") {
    return shiftWorkshopAnchorDateKey(anchorDateKey, view, direction);
  }

  const { from } = buildVisibleRange(anchorDateKey, view, weekRangeMode);
  const nextStart = addDays(parseDateKey(from), direction);
  return formatDateKey(getAnchorDateForVisibleWeekStart(nextStart, weekRangeMode));
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

const getDayScheduleBounds = (
  day: CalendarResponse["days"][number] | null | undefined,
  timeline: { openMinutes: number; closeMinutes: number },
) => {
  const openMinutes = parseClockMinutes(day?.opensAt) ?? timeline.openMinutes;
  const rawCloseMinutes = parseClockMinutes(day?.closesAt);
  const fallbackCloseMinutes = Math.max(openMinutes + MIN_SCHEDULE_DURATION_MINUTES, timeline.closeMinutes);
  const closeMinutes =
    rawCloseMinutes !== null && rawCloseMinutes > openMinutes
      ? rawCloseMinutes
      : fallbackCloseMinutes;

  return {
    openMinutes,
    closeMinutes,
    isClosed: Boolean(day?.isClosed),
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

const getDayCapacityUtilisationIndicator = (summary: {
  totalMinutes: number;
  bookedMinutes: number;
}) => {
  if (summary.totalMinutes <= 0) {
    return {
      label: "No capacity",
      title: summary.bookedMinutes > 0
        ? `${summary.bookedMinutes} booked mins with no staffed capacity`
        : "No staffed capacity available",
      tone: "none" as const,
    };
  }

  const utilisation = summary.bookedMinutes / summary.totalMinutes;
  const percentUsed = Math.round(utilisation * 100);

  if (utilisation > 1) {
    return {
      label: "Over capacity",
      title: `${percentUsed}% utilised (${summary.bookedMinutes} of ${summary.totalMinutes} mins booked)`,
      tone: "overloaded" as const,
    };
  }

  if (utilisation >= 0.75) {
    return {
      label: `${percentUsed}% used`,
      title: `${percentUsed}% utilised (${summary.bookedMinutes} of ${summary.totalMinutes} mins booked)`,
      tone: "tight" as const,
    };
  }

  return {
    label: `${percentUsed}% used`,
    title: `${percentUsed}% utilised (${summary.bookedMinutes} of ${summary.totalMinutes} mins booked)`,
    tone: "healthy" as const,
  };
};

const getCompactTechnicianName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Unknown";
  }

  return trimmed.split(/\s+/)[0] || trimmed;
};

const getDayTechnicianAvailabilitySummary = (
  staffRows: CalendarStaffRow[],
  dateKey: string,
  technicianId: string,
) => {
  const rows = technicianId
    ? staffRows.filter((staff) => staff.id === technicianId)
    : staffRows;

  const availableStaff = rows
    .filter((staff) => staff.availability.some((entry) => (
      entry.date === dateKey
      && entry.source !== "UNAVAILABLE"
      && entry.totalMinutes > 0
    )))
    .map((staff) => ({
      fullName: staff.name,
      compactName: getCompactTechnicianName(staff.name),
    }))
    .sort((left, right) => left.fullName.localeCompare(right.fullName));

  if (availableStaff.length === 0) {
    return {
      label: "Unstaffed",
      title: "No technicians available",
      hasAvailability: false,
    };
  }

  const maxVisible = 2;
  const visibleNames = availableStaff.slice(0, maxVisible).map((staff) => staff.compactName);
  const remainingCount = Math.max(0, availableStaff.length - visibleNames.length);
  const suffix = remainingCount > 0 ? ` +${remainingCount}` : "";

  return {
    label: `In: ${visibleNames.join(", ")}${suffix}`,
    title: `In: ${availableStaff.map((staff) => staff.fullName).join(", ")}`,
    hasAvailability: true,
  };
};

const getWorkshopTimeOffBlocksForDay = (
  entries: CalendarTimeOff[],
  dateKey: string,
  openMinutes: number,
  closeMinutes: number,
  pxPerMinute: number,
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
      top: (clippedStart - openMinutes) * pxPerMinute,
      height: Math.max(18, (clippedEnd - clippedStart) * pxPerMinute),
      scope: entry.scope,
      label: entry.reason || (entry.scope === "WORKSHOP" ? "Workshop block" : "Time off"),
    }];
  });
};

const buildSchedulerCollisionGroups = (entries: SchedulerLayoutEntry[]) => {
  const groups: SchedulerCollisionGroup[] = [];

  entries.forEach((entry) => {
    const currentGroup = groups.at(-1);
    if (!currentGroup || entry.clippedStart >= currentGroup.maxEndMinutes) {
      groups.push({
        entries: [entry],
        maxEndMinutes: entry.clippedEnd,
      });
      return;
    }

    currentGroup.entries.push(entry);
    currentGroup.maxEndMinutes = Math.max(currentGroup.maxEndMinutes, entry.clippedEnd);
  });

  return groups;
};

const pickFirstAvailableLaneIndex = (
  laneStates: SchedulerLaneState[],
  entry: SchedulerLayoutEntry,
) => {
  const laneIndex = laneStates.findIndex((lane) => lane.endMinutes <= entry.clippedStart);

  if (laneIndex < 0) {
    laneStates.push({
      endMinutes: entry.clippedEnd,
    });
    return laneStates.length - 1;
  }

  laneStates[laneIndex] = {
    endMinutes: entry.clippedEnd,
  };

  return laneIndex;
};

const entriesVisiblyOverlap = (
  left: Pick<SchedulerLayoutEntry, "clippedStart" | "clippedEnd">,
  right: Pick<SchedulerLayoutEntry, "clippedStart" | "clippedEnd">,
) => left.clippedStart < right.clippedEnd && right.clippedStart < left.clippedEnd;

const getExpandedLaneSpan = (
  laneAssignments: Array<SchedulerLayoutEntry & { laneIndex: number }>,
  currentEntry: SchedulerLayoutEntry & { laneIndex: number },
  laneCount: number,
) => {
  let span = 1;

  for (let laneIndex = currentEntry.laneIndex + 1; laneIndex < laneCount; laneIndex += 1) {
    const laneBlocked = laneAssignments.some((entry) =>
      entry.job.id !== currentEntry.job.id
      && entry.laneIndex === laneIndex
      && entriesVisiblyOverlap(entry, currentEntry));

    if (laneBlocked) {
      break;
    }

    span += 1;
  }

  return span;
};

const toPositionedJobs = (
  jobs: CalendarJob[],
  openMinutes: number,
  closeMinutes: number,
  columnWidth: number,
  pxPerMinute: number,
  minBookingBlockHeight: number,
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
    .filter((entry): entry is SchedulerLayoutEntry => Boolean(entry))
    .sort((left, right) =>
      left.clippedStart - right.clippedStart
      || right.clippedEnd - left.clippedEnd
      || left.job.createdAt.localeCompare(right.job.createdAt));

  const collisionGroups = buildSchedulerCollisionGroups(sortableJobs);

  return collisionGroups.flatMap<PositionedJob>((group) => {
    const laneStates: SchedulerLaneState[] = [];
    const laneAssignments = group.entries.map((entry) => ({
      ...entry,
      laneIndex: pickFirstAvailableLaneIndex(laneStates, entry),
    }));

    const effectiveLaneCount = Math.max(1, laneStates.length);
    const totalGap = JOB_BLOCK_GAP * (effectiveLaneCount - 1);
    const laneWidth = Math.max(0, (columnWidth - totalGap) / effectiveLaneCount);

    return laneAssignments.map<PositionedJob>((entry) => {
      const laneSpan = getExpandedLaneSpan(laneAssignments, entry, effectiveLaneCount);

      return {
        job: entry.job,
        top: (entry.clippedStart - openMinutes) * pxPerMinute,
        height: Math.max(minBookingBlockHeight, (entry.clippedEnd - entry.clippedStart) * pxPerMinute),
        left: entry.laneIndex * (laneWidth + JOB_BLOCK_GAP),
        width: (laneWidth * laneSpan) + (JOB_BLOCK_GAP * (laneSpan - 1)),
      };
    });
  });
};

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

const getSchedulerBlockDensity = (height: number): SchedulerBlockDensity => {
  if (height < MINIMAL_BOOKING_BLOCK_HEIGHT) {
    return "minimal";
  }

  if (height < COMPACT_BOOKING_BLOCK_HEIGHT) {
    return "compact";
  }

  return "full";
};

const getSchedulerBlockDensityClass = (density: SchedulerBlockDensity) => {
  switch (density) {
    case "minimal":
      return " workshop-scheduler-block--minimal";
    case "compact":
      return " workshop-scheduler-block--compact";
    default:
      return "";
  }
};

const getInteractionModifierClass = (interaction: SchedulerInteractionMode) => {
  switch (interaction) {
    case "resize-top":
      return " workshop-scheduler-block--resizing-top";
    case "resize-bottom":
      return " workshop-scheduler-block--resizing-bottom";
    default:
      return "";
  }
};

const buildPreviewPosition = (input: {
  job: CalendarJob;
  jobs: CalendarJob[];
  dateKey: string;
  startMinutes: number;
  durationMinutes: number;
  openMinutes: number;
  closeMinutes: number;
  columnWidth: number;
  pxPerMinute: number;
  minBookingBlockHeight: number;
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
    input.pxPerMinute,
    input.minBookingBlockHeight,
    input.timeZone,
  ).find((entry) => entry.job.id === previewJob.id) ?? null;
};

const renderSchedulerBlockContent = ({
  job,
  timeLabel,
  metaLabel,
  technicianOverride,
  density,
  todayKey,
  timeZone,
}: {
  job: CalendarJob;
  timeLabel: string;
  metaLabel: string;
  technicianOverride?: string | null;
  density: SchedulerBlockDensity;
  todayKey: string;
  timeZone?: string;
}) => {
  const technician = getBookingTechnicianLabel(job, technicianOverride);
  const showTechnician = true;
  const showBike = density === "full";
  const showMeta = density === "full";
  const signals = buildSchedulerSignals(job, todayKey, timeZone);

  return (
    <>
      <div className="workshop-scheduler-block__time">{timeLabel}</div>
      <strong className="workshop-scheduler-block__customer">
        <span className="workshop-scheduler-block__customer-name">
          {getBookingCustomerName(job)}
        </span>
      </strong>
      {showTechnician ? (
        <div
          className={`workshop-scheduler-block__technician${technician.assigned ? "" : " workshop-scheduler-block__technician--unassigned"}`}
        >
          <span className="workshop-scheduler-block__technician-icon" aria-hidden="true">
            👨‍🔧
          </span>
          <span className="workshop-scheduler-block__technician-name">
            {technician.label}
          </span>
        </div>
      ) : null}
      {showBike ? (
        <div className="workshop-scheduler-block__bike">
          {getBookingBikeLine(job)}
        </div>
      ) : null}
      {showMeta ? (
        <div className="workshop-scheduler-block__meta">
          {metaLabel}
        </div>
      ) : null}
      <SchedulerSignals signals={signals} />
    </>
  );
};

const buildJobToneClass = (job: CalendarJob, todayKey: string, timeZone?: string) => {
  const classes = ["workshop-scheduler-block", workshopRawStatusSurfaceClass(job)];
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
  weekRangeMode = "calendar",
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
  const [overlayJobId, setOverlayJobId] = useState<string | null>(null);
  const [overlaySummary, setOverlaySummary] = useState<WorkshopJobOverlaySummary | null>(null);
  const [internalTechnicianId, setInternalTechnicianId] = useState("");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragSavingJobId, setDragSavingJobId] = useState<string | null>(null);
  const [pendingTechnicianPrompt, setPendingTechnicianPrompt] = useState<PendingTechnicianPromptState | null>(null);
  const [pendingTechnicianPickerHeight, setPendingTechnicianPickerHeight] = useState(TECHNICIAN_PICKER_MIN_HEIGHT);
  const [schedulerViewportWidth, setSchedulerViewportWidth] = useState(0);
  const [schedulerZoom, setSchedulerZoom] = useState<SchedulerZoomLevel>(() => readStoredSchedulerZoomLevel());
  const dayTrackRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const schedulerScrollRef = useRef<HTMLDivElement | null>(null);
  const loadCalendarRequestIdRef = useRef(0);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickJobIdRef = useRef<string | null>(null);
  const technicianPickerRef = useRef<HTMLDivElement | null>(null);
  const pendingBookingRef = useRef<HTMLButtonElement | null>(null);

  const updateDragState = (nextState: DragState | null) => {
    dragStateRef.current = nextState;
    setDragState(nextState);
  };

  const standaloneView = searchParams.get("view") === "day" ? "day" : "week";
  const standaloneAnchorDateKey = searchParams.get("date") || workshopTodayDateKey();
  const standaloneOverview = !embedded;
  const view = controlledView ?? standaloneView;
  const anchorDateKey = controlledAnchorDateKey ?? standaloneAnchorDateKey;
  const selectedTechnicianId = technicianId ?? internalTechnicianId;
  const requestedRange = useMemo(
    () => buildVisibleRange(anchorDateKey, view, weekRangeMode),
    [anchorDateKey, view, weekRangeMode],
  );
  const schedulerZoomOption = useMemo(
    () => SCHEDULER_ZOOM_OPTIONS.find((option) => option.value === schedulerZoom) ?? SCHEDULER_ZOOM_OPTIONS[1],
    [schedulerZoom],
  );
  const pxPerMinute = schedulerZoomOption.pxPerMinute;
  const minBookingBlockHeight = getMinimumBookingBlockHeight(pxPerMinute);
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

  const changeSchedulerZoom = (nextZoom: SchedulerZoomLevel) => {
    setSchedulerZoom(nextZoom);
  };

  const loadCalendar = async () => {
    const requestId = ++loadCalendarRequestIdRef.current;
    setLoading(true);
    setLoadError(null);

    try {
      const payload = await apiGet<CalendarResponse>(
        `/api/workshop/calendar?from=${encodeURIComponent(requestedRange.from)}&to=${encodeURIComponent(requestedRange.to)}`,
      );
      if (requestId !== loadCalendarRequestIdRef.current) {
        return;
      }
      setCalendar(payload);
    } catch (loadCalendarError) {
      if (requestId !== loadCalendarRequestIdRef.current) {
        return;
      }
      const message = loadCalendarError instanceof Error
        ? loadCalendarError.message
        : "Failed to load workshop calendar";
      setCalendar(null);
      setLoadError(message);
      error(message);
    } finally {
      if (requestId === loadCalendarRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedRange.from, requestedRange.to, refreshToken]);

  useEffect(() => () => {
    loadCalendarRequestIdRef.current += 1;
  }, []);

  useEffect(() => {
    persistSchedulerZoomLevel(schedulerZoom);
  }, [schedulerZoom]);

  const days = calendar?.days ?? [];
  const timeline = useMemo(() => buildTimelineRange(days), [days]);
  const dayByDate = useMemo(
    () => new Map(days.map((day) => [day.date, day])),
    [days],
  );
  const timeLabels = useMemo(() => toTimeLabels(timeline), [timeline]);
  const trackHeight = Math.max(MIN_SCHEDULER_TRACK_HEIGHT, timeline.totalMinutes * pxPerMinute);
  const dayColumnWidth = useMemo(() => {
    if (view !== "week") {
      return DAY_VIEW_WIDTH;
    }

    const visibleDayCount = Math.max(days.length, 1);
    const availableWidth = schedulerViewportWidth - TIME_AXIS_WIDTH;
    const minimumWeekDayWidth = standaloneOverview ? STANDALONE_WEEK_DAY_WIDTH : WEEK_DAY_WIDTH;
    if (availableWidth <= 0) {
      return minimumWeekDayWidth;
    }

    return Math.max(minimumWeekDayWidth, Math.floor(availableWidth / visibleDayCount));
  }, [days.length, schedulerViewportWidth, standaloneOverview, view]);
  const schedulerGridTemplateColumns = useMemo(() => {
    if (view === "week") {
      const minimumWeekDayWidth = standaloneOverview ? STANDALONE_WEEK_DAY_WIDTH : WEEK_DAY_WIDTH;
      return `${TIME_AXIS_WIDTH}px repeat(${Math.max(days.length, 1)}, minmax(${minimumWeekDayWidth}px, 1fr))`;
    }

    return `${TIME_AXIS_WIDTH}px repeat(${Math.max(days.length, 1)}, ${dayColumnWidth}px)`;
  }, [dayColumnWidth, days.length, standaloneOverview, view]);

  useEffect(() => {
    const node = schedulerScrollRef.current;
    if (!node) {
      return;
    }

    const updateWidth = (nextWidth: number) => {
      setSchedulerViewportWidth((current) => {
        const rounded = Math.max(0, Math.floor(nextWidth));
        return current === rounded ? current : rounded;
      });
    };

    updateWidth(node.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      updateWidth(entry.contentRect.width);
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [days.length, view]);
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

  useEffect(() => {
    if (!requestedOverlayJobId) {
      return;
    }

    const requestedJob = allJobsById.get(requestedOverlayJobId) ?? null;
    if (!requestedJob) {
      return;
    }

    setOverlaySummary(toOverlaySummary(requestedJob));
    setOverlayJobId(requestedOverlayJobId);
    onRequestedOverlayJobHandled?.();
  }, [allJobsById, onRequestedOverlayJobHandled, requestedOverlayJobId]);

  useEffect(() => {
    if (selectedTechnicianId && !(calendar?.staff ?? []).some((staff) => staff.id === selectedTechnicianId)) {
      changeTechnicianId("");
    }
  }, [calendar?.staff, selectedTechnicianId]);

  useEffect(() => {
    if (!pendingTechnicianPrompt) {
      return;
    }

    const dismissPendingPrompt = () => {
      setPendingTechnicianPrompt(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target
        && (
          technicianPickerRef.current?.contains(target)
          || pendingBookingRef.current?.contains(target)
        )
      ) {
        return;
      }
      dismissPendingPrompt();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissPendingPrompt();
      }
    };

    const handleViewportChange = () => {
      dismissPendingPrompt();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [pendingTechnicianPrompt]);

  useLayoutEffect(() => {
    if (!pendingTechnicianPrompt) {
      setPendingTechnicianPickerHeight(TECHNICIAN_PICKER_MIN_HEIGHT);
      return;
    }

    const nextHeight = technicianPickerRef.current?.getBoundingClientRect().height;
    if (!nextHeight) {
      return;
    }

    setPendingTechnicianPickerHeight((current) => {
      const rounded = Math.max(TECHNICIAN_PICKER_MIN_HEIGHT, Math.ceil(nextHeight));
      return current === rounded ? current : rounded;
    });
  }, [calendar?.staff?.length, pendingTechnicianPrompt]);

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

      const nextActive = current.active
        || Math.max(
          Math.abs(event.clientX - current.startClientX),
          Math.abs(event.clientY - current.startClientY),
        ) >= DRAG_START_THRESHOLD_PX;

      if (current.interaction === "resize-top" || current.interaction === "resize-bottom") {
        if (!current.dateKey || current.fixedBoundaryMinutes === null) {
          return;
        }

        const track = dayTrackRefs.current[current.dateKey];
        if (!track) {
          return;
        }

        if (!nextActive) {
          return;
        }

        const bounds = getDayScheduleBounds(dayByDate.get(current.dateKey), timeline);
        const pointerMinutes =
          timeline.openMinutes
          + ((event.clientY - track.getBoundingClientRect().top) / pxPerMinute);
        const snappedMinutes = snapMinutesToGrid(pointerMinutes, DRAG_SNAP_MINUTES);

        let snappedStartMinutes = current.snappedStartMinutes;
        let durationMinutes = current.durationMinutes;

        if (current.interaction === "resize-top") {
          const maxStartMinutes = Math.max(
            bounds.openMinutes,
            current.fixedBoundaryMinutes - MIN_SCHEDULE_DURATION_MINUTES,
          );
          snappedStartMinutes = clamp(snappedMinutes, bounds.openMinutes, maxStartMinutes);
          durationMinutes = current.fixedBoundaryMinutes - snappedStartMinutes;
        } else {
          const minEndMinutes = current.fixedBoundaryMinutes + MIN_SCHEDULE_DURATION_MINUTES;
          const maxEndMinutes = Math.max(minEndMinutes, bounds.closeMinutes);
          const snappedEndMinutes = clamp(snappedMinutes, minEndMinutes, maxEndMinutes);
          snappedStartMinutes = current.fixedBoundaryMinutes;
          durationMinutes = snappedEndMinutes - current.fixedBoundaryMinutes;
        }

        const previewPosition = buildPreviewPosition({
          job: current.job,
          jobs: jobsByDay.get(current.dateKey) ?? [],
          dateKey: current.dateKey,
          startMinutes: snappedStartMinutes,
          durationMinutes,
          openMinutes: timeline.openMinutes,
          closeMinutes: timeline.closeMinutes,
          columnWidth: dayColumnWidth,
          pxPerMinute,
          minBookingBlockHeight,
          timeZone: calendarTimeZone,
        });
        const nextTop =
          previewPosition?.top
          ?? ((snappedStartMinutes - timeline.openMinutes) * pxPerMinute);
        const nextLeft = previewPosition?.left ?? current.left;
        const nextWidth = previewPosition?.width ?? current.width;
        const nextHeight =
          previewPosition?.height
          ?? Math.max(minBookingBlockHeight, durationMinutes * pxPerMinute);

        if (
          nextTop === current.currentTop
          && nextLeft === current.left
          && nextWidth === current.width
          && nextHeight === current.height
          && snappedStartMinutes === current.snappedStartMinutes
          && durationMinutes === current.durationMinutes
          && nextActive === current.active
        ) {
          return;
        }

        updateDragState({
          ...current,
          active: nextActive,
          left: nextLeft,
          width: nextWidth,
          height: nextHeight,
          currentTop: nextTop,
          snappedStartMinutes,
          durationMinutes,
        });
        event.preventDefault();
        return;
      }

      const target = getDayTrackTarget(event.clientX);
      const track = target?.track;
      const nextDateKey = target?.dateKey ?? null;

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
      const rawMinutes = timeline.openMinutes + (relativeTop / pxPerMinute);
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
        pxPerMinute,
        minBookingBlockHeight,
        timeZone: calendarTimeZone,
      });
      const nextTop =
        previewPosition?.top
        ?? ((snappedStartMinutes - timeline.openMinutes) * pxPerMinute);
      const nextLeft = previewPosition?.left ?? 0;
      const nextWidth = previewPosition?.width ?? dayColumnWidth;
      const nextHeight =
        previewPosition?.height
        ?? Math.max(minBookingBlockHeight, current.durationMinutes * pxPerMinute);

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
        error(
          current.source === "queue"
            ? "Drop the job onto a visible day column to create a timed booking."
            : "Drop the booking onto a visible day column to move it.",
        );
        return;
      }

      if (current.source === "calendar") {
        suppressClickJobIdRef.current = current.job.id;
      }

      if (current.source === "queue" && current.queueKind === "unassigned" && !current.staffId) {
        setPendingTechnicianPrompt({
          source: "queue",
          interaction: "move",
          queueKind: "unassigned",
          job: current.job,
          dateKey: current.dateKey,
          staffId: null,
          left: current.left,
          width: current.width,
          height: current.height,
          currentTop: current.currentTop,
          snappedStartMinutes: current.snappedStartMinutes,
          durationMinutes: current.durationMinutes,
          fixedBoundaryMinutes: null,
        });
        return;
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
  }, [calendarTimeZone, dayByDate, dayColumnWidth, days, dragState, error, jobsByDay, minBookingBlockHeight, pxPerMinute, timeline]);

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
          pxPerMinute,
          minBookingBlockHeight,
          calendarTimeZone,
        ),
      );
    });
    return next;
  }, [calendarTimeZone, dayColumnWidth, days, jobsByDay, minBookingBlockHeight, pxPerMinute, timeline.closeMinutes, timeline.openMinutes]);

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
          pxPerMinute,
          calendarTimeZone,
        ),
      );
    });
    return next;
  }, [calendar?.workshopTimeOff, calendarTimeZone, days, pxPerMinute, selectedTechnicianId, timeline.closeMinutes, timeline.openMinutes]);

  const staffCount = calendar?.staff.length ?? 0;
  const staffFilterOptions = calendar?.staff ?? [];
  const selectedTechnician = staffFilterOptions.find((staff) => staff.id === selectedTechnicianId) ?? null;
  const overlayTechnicianOptions = useMemo<WorkshopOverlayTechnicianOption[]>(
    () => staffFilterOptions.map((staff) => ({ id: staff.id, name: staff.name })),
    [staffFilterOptions],
  );

  const openJobOverlay = (job: CalendarJob) => {
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

  const completePendingTechnicianPrompt = async (staffId: string) => {
    if (!pendingTechnicianPrompt) {
      return;
    }

    const didPersist = await persistDraggedSchedule({
      ...pendingTechnicianPrompt,
      staffId,
    });
    if (didPersist) {
      setPendingTechnicianPrompt(null);
    }
  };

  const pendingTechnicianPickerLayout = useMemo<PendingTechnicianPickerLayout | null>(() => {
    if (!pendingTechnicianPrompt || typeof window === "undefined") {
      return null;
    }

    const track = dayTrackRefs.current[pendingTechnicianPrompt.dateKey];
    if (!track) {
      return null;
    }

    const trackRect = track.getBoundingClientRect();
    const pickerHeight = pendingTechnicianPickerHeight;
    const viewportMaxTop = Math.max(TECHNICIAN_PICKER_VIEWPORT_GAP, window.innerHeight - pickerHeight - TECHNICIAN_PICKER_VIEWPORT_GAP);
    const anchorTop = trackRect.top + pendingTechnicianPrompt.currentTop;
    const anchorBottom = anchorTop + pendingTechnicianPrompt.height;
    const spaceBelow = window.innerHeight - anchorBottom - TECHNICIAN_PICKER_VIEWPORT_GAP;
    const spaceAbove = anchorTop - TECHNICIAN_PICKER_VIEWPORT_GAP;
    const preferredTop = spaceBelow >= pickerHeight || spaceBelow >= spaceAbove
      ? anchorBottom + 8
      : anchorTop - pickerHeight - 8;
    const top = clampPickerPosition(preferredTop, TECHNICIAN_PICKER_VIEWPORT_GAP, viewportMaxTop);
    const preferredLeft = trackRect.left + pendingTechnicianPrompt.left + 8;
    const left = clampPickerPosition(
      preferredLeft,
      TECHNICIAN_PICKER_VIEWPORT_GAP,
      Math.max(TECHNICIAN_PICKER_VIEWPORT_GAP, window.innerWidth - TECHNICIAN_PICKER_WIDTH - TECHNICIAN_PICKER_VIEWPORT_GAP),
    );
    const maxHeight = Math.max(96, window.innerHeight - (top + TECHNICIAN_PICKER_VIEWPORT_GAP));

    return { top, left, maxHeight };
  }, [pendingTechnicianPickerHeight, pendingTechnicianPrompt]);
  const isDraggingPendingTechnicianPrompt = Boolean(
    pendingTechnicianPrompt
    && dragState?.job.id === pendingTechnicianPrompt.job.id,
  );

  const getDragPreviewMetaLabel = (state: PlacementState) => {
    if (state.interaction === "resize-top" || state.interaction === "resize-bottom") {
      return `Release to resize to ${buildBlockTimeLabel(state.snappedStartMinutes, state.durationMinutes)}`;
    }

    if (state.source === "queue") {
      return state.queueKind === "unassigned" && !state.staffId
        ? `Drop to place, then pick technician at ${formatClockLabel(state.snappedStartMinutes)}`
        : `Drop to schedule${state.staffId && selectedTechnician ? ` with ${selectedTechnician.name}` : ""} at ${formatClockLabel(state.snappedStartMinutes)}`;
    }

    return `Drop to move this booking to ${formatClockLabel(state.snappedStartMinutes)}`;
  };

  const persistDraggedSchedule = async (state: PlacementState) => {
    if (!state.dateKey) {
      error("Could not calculate a workshop day for this drop.");
      return false;
    }

    const startTimeValue = formatClockLabel(state.snappedStartMinutes);
    const scheduledStartAt = buildScheduleIso(state.dateKey, startTimeValue);
    if (!scheduledStartAt) {
      error("Could not calculate the dropped booking time.");
      return false;
    }

    setDragSavingJobId(state.job.id);

    try {
      const response = await apiPatch<SchedulePatchResponse>(
        `/api/workshop/jobs/${encodeURIComponent(state.job.id)}/schedule`,
        {
          staffId: state.staffId,
          scheduledStartAt,
          durationMinutes: state.durationMinutes,
        },
      );

      const assignedStaffName = state.staffId
        ? staffFilterOptions.find((staff) => staff.id === state.staffId)?.name ?? null
        : null;
      const timeLabel = buildBlockTimeLabel(state.snappedStartMinutes, state.durationMinutes);
      const placementLabel = assignedStaffName ? `${timeLabel} with ${assignedStaffName}` : timeLabel;

      success(
        response.idempotent
          ? `Booking already matched ${placementLabel}.`
          : state.interaction === "resize-top" || state.interaction === "resize-bottom"
            ? `Booking resized to ${timeLabel}.`
            : state.source === "queue"
            ? `Scheduled for ${placementLabel}.`
            : `Booking moved to ${placementLabel}.`,
      );
      await loadCalendar();
      return true;
    } catch (dragError) {
      const message = dragError instanceof Error ? dragError.message : "Failed to update workshop schedule";
      error(message);
      return false;
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
    if (event.button !== 0 || Boolean(dragSavingJobId)) {
      return;
    }

    const blockRect = event.currentTarget.getBoundingClientRect();
    const pointerOffsetY = event.clientY - blockRect.top;
    const resizeEdge =
      pointerOffsetY <= 12
        ? "top"
        : blockRect.height - pointerOffsetY <= 12
          ? "bottom"
          : null;
    const durationMinutes = getScheduledDurationMinutes(job, calendarTimeZone);
    const startMinutes = getMinutesInTimeZone(job.scheduledStartAt, calendarTimeZone);
    if (!durationMinutes || startMinutes === null) {
      return;
    }

    if (resizeEdge === "top" || resizeEdge === "bottom") {
      const dayBounds = getDayScheduleBounds(dayByDate.get(dateKey), timeline);
      if (dayBounds.isClosed) {
        error("Closed workshop days can't be resized from the calendar.");
        return;
      }

      event.preventDefault();
      setPendingTechnicianPrompt(null);

      updateDragState({
        source: "calendar",
        interaction: resizeEdge === "top" ? "resize-top" : "resize-bottom",
        queueKind: null,
        pointerId: event.pointerId,
        job,
        dateKey,
        staffId: job.assignedStaffId || null,
        left,
        width,
        height,
        pointerOffsetY,
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentTop: top,
        snappedStartMinutes: startMinutes,
        durationMinutes,
        fixedBoundaryMinutes: resizeEdge === "top" ? startMinutes + durationMinutes : startMinutes,
        active: false,
      });
      return;
    }

    setPendingTechnicianPrompt(null);
    updateDragState({
      source: "calendar",
      interaction: "move",
      queueKind: null,
      pointerId: event.pointerId,
      job,
      dateKey,
      staffId: job.assignedStaffId || null,
      left,
      width,
      height,
      pointerOffsetY,
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentTop: top,
      snappedStartMinutes: startMinutes,
      durationMinutes,
      fixedBoundaryMinutes: null,
      active: false,
    });
  };

  const handlePendingPromptPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    pendingPrompt: PendingTechnicianPromptState,
  ) => {
    if (event.button !== 0 || Boolean(dragSavingJobId)) {
      return;
    }

    const blockRect = event.currentTarget.getBoundingClientRect();
    updateDragState({
      source: "queue",
      interaction: "move",
      queueKind: "unassigned",
      pointerId: event.pointerId,
      job: pendingPrompt.job,
      dateKey: pendingPrompt.dateKey,
      staffId: null,
      left: pendingPrompt.left,
      width: pendingPrompt.width,
      height: pendingPrompt.height,
      pointerOffsetY: event.clientY - blockRect.top,
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentTop: pendingPrompt.currentTop,
      snappedStartMinutes: pendingPrompt.snappedStartMinutes,
      durationMinutes: pendingPrompt.durationMinutes,
      fixedBoundaryMinutes: null,
      active: false,
    });
  };

  const handleQueueJobPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    job: CalendarJob,
    queueKind: QueuePlacementKind,
  ) => {
    const target = event.target as HTMLElement | null;
    if (
      event.button !== 0
      || Boolean(dragSavingJobId)
      || target?.closest("button, a, input, select, textarea")
    ) {
      return;
    }

    const durationMinutes = getScheduledDurationMinutes(job, calendarTimeZone);
    const previewHeight = Math.max(minBookingBlockHeight, durationMinutes * pxPerMinute);

    event.preventDefault();
    setPendingTechnicianPrompt(null);

    updateDragState({
      source: "queue",
      interaction: "move",
      queueKind,
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
      fixedBoundaryMinutes: null,
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

  const toolbarLeadingAction: ReactNode = !standaloneOverview && backLinkTo ? (
    <Link to={backLinkTo} className="button-link">Back to Operating System</Link>
  ) : null;

  return (
    <div className={
      embedded
        ? "workshop-scheduler-screen workshop-scheduler-screen--embedded"
        : "page-shell page-shell-workspace workshop-scheduler-page workshop-scheduler-page--standalone"
    }>
      {showToolbar ? (
        <section className={
          embedded
            ? "workshop-scheduler-toolbar workshop-scheduler-toolbar--embedded"
            : "workshop-scheduler-toolbar workshop-scheduler-toolbar--standalone"
        }>
          <div className="card-header-row">
            <div>
              <h1>{title || (embedded ? "Scheduler" : "Workshop Calendar Overview")}</h1>
              <p className="muted-text">
                {description || (
                  embedded
                    ? "Week-first timed scheduling is now the main workshop surface, with day detail on demand and booking blocks rendered directly in the grid."
                    : "A dedicated full-width planning view focused entirely on the workshop calendar, staffing availability, and booking density."
                )}
              </p>
            </div>
            <div className="actions-inline">
              {toolbarLeadingAction}
            </div>
          </div>

          <div className={`workshop-scheduler-toolbar__controls${standaloneOverview ? " workshop-scheduler-toolbar__controls--standalone" : ""}`}>
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

            <label className="workshop-scheduler-toolbar__filter">
              Zoom
              <div className="workshop-scheduler-toolbar__view-toggle" role="tablist" aria-label="Scheduler zoom level">
                {SCHEDULER_ZOOM_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={schedulerZoom === option.value}
                    className={schedulerZoom === option.value ? "primary" : ""}
                    data-testid={`workshop-scheduler-zoom-${option.value}`}
                    onClick={() => changeSchedulerZoom(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </label>

            <div className="actions-inline">
              <button
                type="button"
                onClick={() => changeAnchorDateKey(shiftWorkshopAnchorDateKey(anchorDateKey, view, -1))}
              >
                {view === "week" ? "Previous Week" : "Previous Day"}
              </button>
              {view === "week" && weekRangeMode !== "calendar" ? (
                <button
                  type="button"
                  onClick={() => changeAnchorDateKey(shiftWorkshopVisibleWindowDateKey(anchorDateKey, view, weekRangeMode, -1))}
                >
                  - Day
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => changeAnchorDateKey(workshopTodayDateKey())}
                disabled={anchorDateKey === todayKey}
              >
                Today
              </button>
              {view === "week" && weekRangeMode !== "calendar" ? (
                <button
                  type="button"
                  onClick={() => changeAnchorDateKey(shiftWorkshopVisibleWindowDateKey(anchorDateKey, view, weekRangeMode, 1))}
                >
                  + Day
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => changeAnchorDateKey(shiftWorkshopAnchorDateKey(anchorDateKey, view, 1))}
              >
                {view === "week" ? "Next Week" : "Next Day"}
              </button>
            </div>

            {!standaloneOverview ? (
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
            ) : null}
          </div>

          {!standaloneOverview ? (
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
            <article className="metric-card">
              <span className="metric-label">Zoom</span>
              <strong className="metric-value">{schedulerZoomOption.label}</strong>
              <span className="dashboard-metric-detail">
                {schedulerZoom === "compact"
                  ? "More time visible for weekly overview"
                  : schedulerZoom === "comfortable"
                    ? "Larger booking blocks for precise edits"
                  : "Balanced default density for daily planning"}
              </span>
            </article>
          </div>
          ) : null}
        </section>
      ) : null}

      {loadError ? (
        <section className="restricted-panel warning-panel">
          {loadError}
        </section>
      ) : null}

      <div className={
        embedded
          ? "workshop-scheduler-layout workshop-scheduler-layout--embedded"
          : "workshop-scheduler-layout workshop-scheduler-layout--standalone"
      }>
        <section className={`${embedded ? "workshop-scheduler-board workshop-scheduler-board--embedded" : "workshop-scheduler-board workshop-scheduler-board--standalone"}${dragState?.source === "queue" && dragState.active ? " workshop-scheduler-board--queue-dragging" : ""}`}>
          {!standaloneOverview || !showToolbar ? (
          <div className="workshop-scheduler-board__header">
            <div>
              <h2>{view === "week" ? "Week schedule" : "Day schedule"}</h2>
            </div>
            {!showToolbar ? (
              <div className="workshop-scheduler-toolbar__view-toggle" role="tablist" aria-label="Scheduler zoom level">
                {SCHEDULER_ZOOM_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={schedulerZoom === option.value}
                    className={schedulerZoom === option.value ? "primary" : ""}
                    data-testid={`workshop-scheduler-zoom-${option.value}`}
                    onClick={() => changeSchedulerZoom(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          ) : null}

          <div ref={schedulerScrollRef} className="workshop-scheduler-scroll">
            <div
              className="workshop-scheduler-grid"
              style={{ gridTemplateColumns: schedulerGridTemplateColumns }}
            >
              <div className="workshop-scheduler-grid__corner">Time</div>

              {days.map((day) => {
                const dayCapacity = toDayCapacitySummary(calendar?.staff ?? [], day.date, selectedTechnicianId);
                const dayUtilisation = getDayCapacityUtilisationIndicator(dayCapacity);
                const technicianAvailability = getDayTechnicianAvailabilitySummary(
                  calendar?.staff ?? [],
                  day.date,
                  selectedTechnicianId,
                );
                const visibleDayJobs = jobsByDay.get(day.date)?.length ?? 0;
                const isToday = day.date === todayKey;

                return (
                  <div
                    key={day.date}
                    className={`workshop-scheduler-grid__day-header${isToday ? " workshop-scheduler-grid__day-header--today" : ""}`}
                    data-testid={`workshop-scheduler-day-header-${day.date}`}
                    data-current-day={isToday ? "true" : "false"}
                  >
                    <strong>{day.weekday}</strong>
                    <span>{formatOptionalDate(`${day.date}T12:00:00.000Z`, calendarTimeZone)}</span>
                    <span
                      className={technicianAvailability.hasAvailability
                        ? "workshop-scheduler-grid__day-header-availability"
                        : "workshop-scheduler-grid__day-header-availability workshop-scheduler-grid__day-header-availability--empty"}
                      title={technicianAvailability.title}
                    >
                      {technicianAvailability.label}
                    </span>
                    <span
                      className={`workshop-scheduler-grid__day-header-utilisation workshop-scheduler-grid__day-header-utilisation--${dayUtilisation.tone}`}
                      title={dayUtilisation.title}
                    >
                      {dayUtilisation.label}
                    </span>
                    <span className="workshop-scheduler-grid__day-header-summary">
                      {visibleDayJobs} jobs · {" "}
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
                    style={{ top: `${(minutes - timeline.openMinutes) * pxPerMinute}px` }}
                  >
                    {formatClockLabel(minutes)}
                  </div>
                ))}
              </div>

              {days.map((day) => {
                const dayBlocks = positionedJobsByDay.get(day.date) ?? [];
                const timeOffBlocks = workshopTimeOffByDay.get(day.date) ?? [];
                const previewBlock = dragState?.active && dragState.dateKey === day.date ? dragState : null;
                const pendingPrompt = pendingTechnicianPrompt?.dateKey === day.date ? pendingTechnicianPrompt : null;
                const previewDensity = previewBlock
                  ? getSchedulerBlockDensity(previewBlock.height)
                  : null;
                const pendingDensity = pendingPrompt
                  ? getSchedulerBlockDensity(pendingPrompt.height)
                  : null;
                const isToday = day.date === todayKey;

                return (
                  <div
                    key={`${day.date}-track`}
                    ref={(node) => {
                      dayTrackRefs.current[day.date] = node;
                    }}
                    className={`workshop-scheduler-grid__day-track${isToday ? " workshop-scheduler-grid__day-track--today" : ""}${day.isClosed ? " workshop-scheduler-grid__day-track--closed" : ""}${previewBlock ? " workshop-scheduler-grid__day-track--drag-active" : ""}`}
                    data-testid={`workshop-scheduler-day-track-${day.date}`}
                    style={{ height: `${trackHeight}px` }}
                  >
                    {timeLabels.map((minutes) => (
                      <span
                        key={`${day.date}-${minutes}`}
                        className="workshop-scheduler-grid__hour-line"
                        style={{ top: `${(minutes - timeline.openMinutes) * pxPerMinute}px` }}
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
                      const density = getSchedulerBlockDensity(height);
                      const isDragging = dragState?.active && dragState.job.id === job.id;
                      const interactionClass = isDragging
                        ? getInteractionModifierClass(dragState?.interaction ?? "move")
                        : "";
                      const toneClass = `${buildJobToneClass(job, todayKey, calendarTimeZone)}${getSchedulerBlockDensityClass(density)}${isDragging ? " workshop-scheduler-block--dragging" : ""}${interactionClass}`;

                      return (
                        <button
                          key={job.id}
                          type="button"
                          className={toneClass}
                          data-testid={`workshop-scheduler-job-${job.id}`}
                          title={getBookingTooltip(job, calendarTimeZone)}
                          style={{
                            top: `${top}px`,
                            left: `${left}px`,
                            width: `${width}px`,
                            height: `${height}px`,
                          }}
                          onPointerDown={(event) => handleJobBlockPointerDown(event, job, day.date, top, height, left, width)}
                          onClick={() => handleJobBlockClick(job)}
                          disabled={dragSavingJobId === job.id}
                        >
                          <span
                            className="workshop-scheduler-block__resize-handle workshop-scheduler-block__resize-handle--top"
                            data-testid={`workshop-scheduler-job-resize-top-${job.id}`}
                            data-resize-edge="top"
                            aria-hidden="true"
                          />
                          <span
                            className="workshop-scheduler-block__resize-handle workshop-scheduler-block__resize-handle--bottom"
                            data-testid={`workshop-scheduler-job-resize-bottom-${job.id}`}
                            data-resize-edge="bottom"
                            aria-hidden="true"
                          />
                          {renderSchedulerBlockContent({
                            job,
                            timeLabel: `${formatOptionalTime(job.scheduledStartAt, calendarTimeZone)} - ${formatOptionalTime(job.scheduledEndAt, calendarTimeZone)}`,
                            metaLabel: getBookingMetaLine(job, todayKey, calendarTimeZone),
                            density,
                            todayKey,
                            timeZone: calendarTimeZone,
                          })}
                        </button>
                      );
                    })}

                    {previewBlock && previewDensity ? (
                      <div
                        aria-hidden="true"
                        className={`${buildJobToneClass(previewBlock.job, todayKey, calendarTimeZone)} workshop-scheduler-block--drag-preview${getSchedulerBlockDensityClass(previewDensity)}${getInteractionModifierClass(previewBlock.interaction)}`}
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
                          metaLabel: getDragPreviewMetaLabel(previewBlock),
                          technicianOverride: previewBlock.staffId && selectedTechnician
                            ? selectedTechnician.name
                            : null,
                          density: previewDensity,
                          todayKey,
                          timeZone: calendarTimeZone,
                        })}
                      </div>
                    ) : null}

                    {pendingPrompt && !isDraggingPendingTechnicianPrompt ? (
                      <>
                        {pendingDensity ? (
                        <button
                          ref={pendingBookingRef}
                          type="button"
                          className={`${buildJobToneClass(pendingPrompt.job, todayKey, calendarTimeZone)} workshop-scheduler-block--pending-assignment${getSchedulerBlockDensityClass(pendingDensity)}`}
                          title={getBookingTooltip(pendingPrompt.job, calendarTimeZone)}
                          style={{
                            top: `${pendingPrompt.currentTop}px`,
                            left: `${pendingPrompt.left}px`,
                            width: `${pendingPrompt.width}px`,
                            height: `${pendingPrompt.height}px`,
                          }}
                          onPointerDown={(event) => handlePendingPromptPointerDown(event, pendingPrompt)}
                        >
                          {renderSchedulerBlockContent({
                            job: pendingPrompt.job,
                            timeLabel: buildBlockTimeLabel(pendingPrompt.snappedStartMinutes, pendingPrompt.durationMinutes),
                            metaLabel: "Choose technician to confirm placement",
                            density: pendingDensity,
                            todayKey,
                            timeZone: calendarTimeZone,
                          })}
                        </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {pendingTechnicianPrompt && pendingTechnicianPickerLayout && !isDraggingPendingTechnicianPrompt ? (
              <div
                ref={technicianPickerRef}
                className="workshop-scheduler-technician-picker"
                data-testid={`workshop-scheduler-technician-picker-${pendingTechnicianPrompt.dateKey}`}
                style={{
                  top: `${pendingTechnicianPickerLayout.top}px`,
                  left: `${pendingTechnicianPickerLayout.left}px`,
                  maxHeight: `${pendingTechnicianPickerLayout.maxHeight}px`,
                }}
              >
                <div className="workshop-scheduler-technician-picker__copy">
                  <strong>Assign technician</strong>
                  <span>
                    {buildBlockTimeLabel(pendingTechnicianPrompt.snappedStartMinutes, pendingTechnicianPrompt.durationMinutes)}
                    {" "}
                    on
                    {" "}
                    {days.find((day) => day.date === pendingTechnicianPrompt.dateKey)?.weekday ?? pendingTechnicianPrompt.dateKey}
                  </span>
                </div>
                <div className="workshop-scheduler-technician-picker__actions">
                  {staffFilterOptions.map((staff) => (
                    <button
                      key={staff.id}
                      type="button"
                      data-testid={`workshop-scheduler-technician-option-${staff.id}`}
                      onClick={() => void completePendingTechnicianPrompt(staff.id)}
                      disabled={dragSavingJobId === pendingTechnicianPrompt.job.id}
                    >
                      {staff.name}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="button-link"
                  onClick={() => setPendingTechnicianPrompt(null)}
                  disabled={dragSavingJobId === pendingTechnicianPrompt.job.id}
                >
                  Cancel
                </button>
              </div>
            ) : null}
          </div>
        </section>

        {!standaloneOverview ? (
        <aside className={embedded ? "workshop-scheduler-rail workshop-scheduler-rail--embedded" : "workshop-scheduler-rail"}>
          <section className={embedded ? "workshop-scheduler-panel workshop-scheduler-panel--embedded" : "card workshop-scheduler-panel"}>
            <div className="card-header-row">
              <div>
                <h2>Needs scheduling</h2>
              </div>
              <span className="stock-badge stock-muted">{filteredUnscheduledJobs.length}</span>
            </div>

            <div className="workshop-scheduler-queue">
              {filteredUnscheduledJobs.length === 0 ? (
                <div className="workshop-scheduler-empty">No jobs are waiting for a first timed slot.</div>
              ) : filteredUnscheduledJobs.map((job) => (
                <article
                  key={job.id}
                  className={`workshop-scheduler-queue-card workshop-scheduler-queue-card--draggable ${workshopRawStatusSurfaceClass(job)}${dragState?.source === "queue" && dragState.active && dragState.job.id === job.id ? " workshop-scheduler-queue-card--dragging" : ""}`}
                  onPointerDown={(event) => handleQueueJobPointerDown(event, job, "unscheduled")}
                >
                  <div className="workshop-scheduler-queue-card__topline">
                    <strong className="workshop-scheduler-queue-card__title">{getJobHeading(job)}</strong>
                    <div className="workshop-scheduler-queue-card__actions">
                      <button type="button" onClick={() => openJobOverlay(job)}>Open</button>
                    </div>
                  </div>
                  <div className="table-secondary workshop-scheduler-queue-card__meta">
                    {getQueueMetaLine(job, calendarTimeZone)}
                  </div>
                  <div className="workshop-scheduler-queue-card__footer">
                    <span className="workshop-scheduler-queue-card__drag-hint">Drag to slot</span>
                    <span className={`${workshopRawStatusClass(job)} workshop-scheduler-queue-card__badge`}>
                      {workshopRawStatusLabel(job)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={embedded ? "workshop-scheduler-panel workshop-scheduler-panel--embedded" : "card workshop-scheduler-panel"}>
            <div className="card-header-row">
              <div>
                <h2>Timed but unassigned</h2>
              </div>
              <span className="stock-badge stock-muted">{filteredUnassignedJobs.length}</span>
            </div>

            <div className="workshop-scheduler-queue">
              {filteredUnassignedJobs.length === 0 ? (
                <div className="workshop-scheduler-empty">Every timed booking is assigned to a technician.</div>
              ) : filteredUnassignedJobs.map((job) => (
                <article
                  key={job.id}
                  className={`workshop-scheduler-queue-card workshop-scheduler-queue-card--draggable ${workshopRawStatusSurfaceClass(job)}${dragState?.source === "queue" && dragState.active && dragState.job.id === job.id ? " workshop-scheduler-queue-card--dragging" : ""}`}
                  onPointerDown={(event) => handleQueueJobPointerDown(event, job, "unassigned")}
                >
                  <div className="workshop-scheduler-queue-card__topline">
                    <strong className="workshop-scheduler-queue-card__title">{getJobHeading(job)}</strong>
                    <div className="workshop-scheduler-queue-card__actions">
                      <button type="button" onClick={() => openJobOverlay(job)}>Open</button>
                    </div>
                  </div>
                  <div className="table-secondary workshop-scheduler-queue-card__meta">
                    {getQueueMetaLine(job, calendarTimeZone)}
                  </div>
                  <div className="workshop-scheduler-queue-card__footer">
                    <span className="workshop-scheduler-queue-card__drag-hint">Drag to slot</span>
                    <span className={`${workshopRawStatusClass(job)} workshop-scheduler-queue-card__badge`}>
                      {workshopRawStatusLabel(job)}
                    </span>
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
        ) : null}
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

export const WorkshopCalendarPage = () => <WorkshopSchedulerScreen weekRangeMode="standalone" />;
