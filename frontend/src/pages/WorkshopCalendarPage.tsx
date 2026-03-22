import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import {
  workshopExecutionStatusClass,
  workshopExecutionStatusLabel,
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

type ScheduleDraft = {
  staffId: string;
  startTime: string;
  durationMinutes: string;
};

const PX_PER_MINUTE = 1.8;
const DEFAULT_OPEN_MINUTES = 9 * 60;
const DEFAULT_CLOSE_MINUTES = 18 * 60;
const DURATION_PRESETS = [30, 45, 60, 90, 120, 180];

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

const shiftDateKey = (value: string, days: number) => {
  const next = parseDateKey(value);
  next.setDate(next.getDate() + days);
  return formatDateKey(next);
};

const todayDateKey = () => formatDateKey(new Date());

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

const toLocalTimeInput = (isoValue: string | null | undefined) => {
  if (!isoValue) {
    return "";
  }

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
};

const formatOptionalDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "-";

const formatOptionalTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "-";

const formatDuration = (minutes: number | null | undefined) =>
  minutes ? `${minutes} min` : "-";

const getJobHeading = (job: CalendarJob) =>
  job.bikeDescription || job.customerName || job.summaryText || `Workshop job ${job.id.slice(0, 8)}`;

const getJobSubline = (job: CalendarJob) =>
  [job.customerName, job.assignedStaffName].filter(Boolean).join(" · ") || "Workshop job";

const buildScheduleIso = (dateKey: string, timeValue: string) => {
  if (!timeValue) {
    return null;
  }

  const date = new Date(`${dateKey}T${timeValue}:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
};

const toJobSortValue = (job: CalendarJob) =>
  job.scheduledDate || job.createdAt || "";

const buildInitialDraft = (
  job: CalendarJob,
  calendarDay: CalendarResponse["days"][number] | undefined,
): ScheduleDraft => ({
  staffId: job.assignedStaffId || "",
  startTime: toLocalTimeInput(job.scheduledStartAt) || calendarDay?.opensAt || "10:00",
  durationMinutes: `${job.durationMinutes || 60}`,
});

const buildTimelineRange = (calendarDay: CalendarResponse["days"][number] | undefined) => {
  const openMinutes = parseClockMinutes(calendarDay?.opensAt) ?? DEFAULT_OPEN_MINUTES;
  const closeMinutes = parseClockMinutes(calendarDay?.closesAt) ?? DEFAULT_CLOSE_MINUTES;
  const endMinutes = closeMinutes > openMinutes ? closeMinutes : openMinutes + 60;
  return {
    openMinutes,
    closeMinutes: endMinutes,
    totalMinutes: endMinutes - openMinutes,
  };
};

const getVisibleBlock = (
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  openMinutes: number,
  closeMinutes: number,
) => {
  if (!startIso || !endIso) {
    return null;
  }

  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const startMinutes = (start.getHours() * 60) + start.getMinutes();
  const endMinutes = (end.getHours() * 60) + end.getMinutes();
  const clippedStart = clamp(startMinutes, openMinutes, closeMinutes);
  const clippedEnd = clamp(endMinutes, openMinutes, closeMinutes);
  if (clippedEnd <= clippedStart) {
    return null;
  }

  return {
    left: (clippedStart - openMinutes) * PX_PER_MINUTE,
    width: Math.max(16, (clippedEnd - clippedStart) * PX_PER_MINUTE),
  };
};

const formatRoleLabel = (row: CalendarStaffRow) => {
  if (row.operationalRole && row.operationalRole !== "WORKSHOP") {
    return `${row.role} · ${row.operationalRole}`;
  }
  return row.role;
};

export const WorkshopCalendarPage = () => {
  const { success, error } = useToasts();
  const [searchParams, setSearchParams] = useSearchParams();
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<CalendarJob | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft>({
    staffId: "",
    startTime: "",
    durationMinutes: "60",
  });
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dateKey = searchParams.get("date") || todayDateKey();

  const loadCalendar = async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const payload = await apiGet<CalendarResponse>(
        `/api/workshop/calendar?from=${encodeURIComponent(dateKey)}&to=${encodeURIComponent(dateKey)}`,
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
  }, [dateKey]);

  const calendarDay = calendar?.days[0];
  const timeline = useMemo(() => buildTimelineRange(calendarDay), [calendarDay]);
  const timelineWidth = Math.max(780, timeline.totalMinutes * PX_PER_MINUTE);

  const timeLabels = useMemo(() => {
    const labels: Array<{ label: string; left: number }> = [];
    const startHour = Math.floor(timeline.openMinutes / 60) * 60;
    const endHour = Math.ceil(timeline.closeMinutes / 60) * 60;

    for (let minutes = startHour; minutes <= endHour; minutes += 60) {
      const left = (minutes - timeline.openMinutes) * PX_PER_MINUTE;
      labels.push({
        label: formatClockLabel(minutes),
        left,
      });
    }

    return labels;
  }, [timeline.closeMinutes, timeline.openMinutes]);

  const openEditor = (job: CalendarJob) => {
    setSelectedJob(job);
    setDraft(buildInitialDraft(job, calendarDay));
    setScheduleError(null);
  };

  const closeEditor = () => {
    setSelectedJob(null);
    setScheduleError(null);
  };

  const saveSchedule = async () => {
    if (!selectedJob) {
      return;
    }

    const scheduledStartAt = buildScheduleIso(dateKey, draft.startTime);
    const durationMinutes = Number(draft.durationMinutes);

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
      closeEditor();
      await loadCalendar();
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
      closeEditor();
      await loadCalendar();
    } catch (clearError) {
      const message = clearError instanceof Error ? clearError.message : "Failed to clear timed schedule";
      setScheduleError(message);
      error(message);
    } finally {
      setSaving(false);
    }
  };

  const scheduledJobsCount = calendar?.scheduledJobs.length ?? 0;
  const unscheduledJobs = calendar?.unscheduledJobs ?? [];
  const unassignedTimedJobs = calendar?.unassignedJobs ?? [];

  return (
    <div className="page-shell page-shell-workspace workshop-calendar-page">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Calendar</h1>
            <p className="muted-text">
              Day view for technician cover, timed workshop jobs, time off, and quick scheduling from the live queue.
            </p>
          </div>
          <div className="actions-inline">
            <button
              type="button"
              onClick={() => setSearchParams({ date: shiftDateKey(dateKey, -1) })}
            >
              Previous Day
            </button>
            <button
              type="button"
              onClick={() => setSearchParams({ date: todayDateKey() })}
              disabled={dateKey === todayDateKey()}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setSearchParams({ date: shiftDateKey(dateKey, 1) })}
            >
              Next Day
            </button>
            <Link to="/workshop" className="button-link">Back to Workshop</Link>
            <button type="button" onClick={() => void loadCalendar()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid workshop-calendar-summary-grid">
          <article className="metric-card">
            <span className="metric-label">Day</span>
            <strong className="metric-value">
              {parseDateKey(dateKey).toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "short",
              })}
            </strong>
            <span className="dashboard-metric-detail">{dateKey}</span>
          </article>
          <article className="metric-card">
            <span className="metric-label">Trading Hours</span>
            <strong className="metric-value">
              {calendarDay?.isClosed ? "Closed" : `${calendarDay?.opensAt || "--:--"}-${calendarDay?.closesAt || "--:--"}`}
            </strong>
            <span className="dashboard-metric-detail">
              {calendarDay?.closedReason || `${calendar?.range.timeZone || "Local"} time`}
            </span>
          </article>
          <article className="metric-card">
            <span className="metric-label">Timed Jobs</span>
            <strong className="metric-value">{scheduledJobsCount}</strong>
            <span className="dashboard-metric-detail">
              {unassignedTimedJobs.length} unassigned timed / {unscheduledJobs.length} without a timed slot
            </span>
          </article>
          <article className="metric-card">
            <span className="metric-label">Workshop Time Off</span>
            <strong className="metric-value">{calendar?.workshopTimeOff.length ?? 0}</strong>
            <span className="dashboard-metric-detail">
              {calendar?.usesOperationalRoleTags
                ? "Using workshop role tags"
                : "Using broad active-staff fallback"}
            </span>
          </article>
        </div>
      </section>

      {loadError ? (
        <section className="restricted-panel warning-panel">
          {loadError}
        </section>
      ) : null}

      <div className="workshop-calendar-layout">
        <section className="card workshop-calendar-board">
          <div className="card-header-row">
            <div>
              <h2>Day Grid</h2>
              <p className="muted-text">
                Scheduled jobs open their workshop record directly. Use the edit action on a job card or the queue to plan time and assignment.
              </p>
            </div>
          </div>

          {calendarDay?.isClosed ? (
            <div className="restricted-panel info-panel">
              {calendarDay.closedReason || "Store is closed on this day. Timed scheduling is unavailable until the next open day."}
            </div>
          ) : null}

          {!calendarDay?.isClosed ? (
            <div className="workshop-calendar-scroll">
              <div className="workshop-calendar-grid" style={{ minWidth: `${timelineWidth + 210}px` }}>
                <div className="workshop-calendar-header-row">
                  <div className="workshop-calendar-staff-col">
                    <strong>Staff</strong>
                  </div>
                  <div className="workshop-calendar-time-col" style={{ width: `${timelineWidth}px` }}>
                    {timeLabels.map((label) => (
                      <span
                        key={`${label.label}-${label.left}`}
                        className="workshop-calendar-time-label mono-text"
                        style={{ left: `${label.left}px` }}
                      >
                        {label.label}
                      </span>
                    ))}
                  </div>
                </div>

                {calendar?.staff.length ? calendar.staff.map((staff) => {
                  const workingHours = staff.workingHours[0] ?? null;
                  const capacity = staff.dailyCapacity[0] ?? null;
                  const workingStart = parseClockMinutes(workingHours?.startTime) ?? timeline.openMinutes;
                  const workingEnd = parseClockMinutes(workingHours?.endTime) ?? timeline.openMinutes;
                  const workingHoursBlock = workingHours
                    ? {
                        left: (workingStart - timeline.openMinutes) * PX_PER_MINUTE,
                        width: Math.max(12, (workingEnd - workingStart) * PX_PER_MINUTE),
                      }
                    : null;

                  return (
                    <div key={staff.id} className="workshop-calendar-row">
                      <div className="workshop-calendar-staff-col">
                        <div className="workshop-calendar-staff-name">{staff.name}</div>
                        <div className="table-secondary">{formatRoleLabel(staff)}</div>
                        <div className="table-secondary">
                          {workingHours ? `${workingHours.startTime}-${workingHours.endTime}` : "No workshop hours"}
                        </div>
                        {capacity ? (
                          <div className="table-secondary">
                            {capacity.bookedMinutes} booked / {capacity.availableMinutes} free
                          </div>
                        ) : null}
                      </div>
                      <div
                        className={`workshop-calendar-track${workingHours ? "" : " workshop-calendar-track--unavailable"}`}
                        style={{ width: `${timelineWidth}px` }}
                      >
                        {workingHoursBlock ? (
                          <div
                            className="workshop-calendar-working-band"
                            style={{
                              left: `${workingHoursBlock.left}px`,
                              width: `${workingHoursBlock.width}px`,
                            }}
                          />
                        ) : null}

                        {staff.timeOff.map((entry) => {
                          const block = getVisibleBlock(
                            entry.startAt,
                            entry.endAt,
                            timeline.openMinutes,
                            timeline.closeMinutes,
                          );
                          if (!block) {
                            return null;
                          }

                          return (
                            <div
                              key={entry.id}
                              className={`workshop-calendar-timeoff workshop-calendar-timeoff--${entry.scope.toLowerCase()}`}
                              style={{ left: `${block.left}px`, width: `${block.width}px` }}
                              title={entry.reason || (entry.scope === "WORKSHOP" ? "Workshop time off" : "Staff time off")}
                            >
                              <span>{entry.reason || (entry.scope === "WORKSHOP" ? "Workshop block" : "Time off")}</span>
                            </div>
                          );
                        })}

                        {staff.scheduledJobs.map((job) => {
                          const block = getVisibleBlock(
                            job.scheduledStartAt,
                            job.scheduledEndAt,
                            timeline.openMinutes,
                            timeline.closeMinutes,
                          );
                          if (!block) {
                            return null;
                          }

                          return (
                            <div
                              key={job.id}
                              className="workshop-calendar-job"
                              style={{ left: `${block.left}px`, width: `${block.width}px` }}
                            >
                              <Link to={job.jobPath} className="workshop-calendar-job-link">
                                <strong>{getJobHeading(job)}</strong>
                                <span>{formatOptionalTime(job.scheduledStartAt)}-{formatOptionalTime(job.scheduledEndAt)}</span>
                                <span>{job.customerName || workshopRawStatusLabel(job.rawStatus)}</span>
                              </Link>
                              <button
                                type="button"
                                className="workshop-calendar-job-edit"
                                onClick={() => openEditor(job)}
                              >
                                Edit
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }) : (
                  <div className="restricted-panel info-panel">
                    No active workshop staff rows are available for this day yet.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>

        <aside className="workshop-calendar-sidebar">
          <section className="card workshop-calendar-panel">
            <div className="card-header-row">
              <div>
                <h2>{selectedJob ? "Schedule Editor" : "Scheduling Queue"}</h2>
                <p className="muted-text">
                  {selectedJob
                    ? "Set the timed slot and assigned mechanic for the selected job."
                    : "Pick an unscheduled or unassigned job to plan it for this day."}
                </p>
              </div>
              {selectedJob ? (
                <button type="button" onClick={closeEditor} disabled={saving}>
                  Close
                </button>
              ) : null}
            </div>

            {selectedJob ? (
              <div className="workshop-calendar-editor">
                <div className="workshop-calendar-editor-summary">
                  <strong>{getJobHeading(selectedJob)}</strong>
                  <span className={workshopExecutionStatusClass(selectedJob.status, selectedJob.rawStatus)}>
                    {workshopExecutionStatusLabel(selectedJob.status)}
                  </span>
                  <div className="table-secondary">{getJobSubline(selectedJob)}</div>
                  <div className="table-secondary">
                    Current slot: {selectedJob.scheduledStartAt
                      ? `${formatOptionalTime(selectedJob.scheduledStartAt)}-${formatOptionalTime(selectedJob.scheduledEndAt)}`
                      : "No timed slot yet"}
                  </div>
                </div>

                <label>
                  Assign staff
                  <select
                    value={draft.staffId}
                    onChange={(event) => setDraft((current) => ({ ...current, staffId: event.target.value }))}
                    disabled={saving}
                  >
                    <option value="">Leave unassigned</option>
                    {(calendar?.staff ?? []).map((staff) => (
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
                      disabled={saving || Boolean(calendarDay?.isClosed)}
                    />
                  </label>
                  <label>
                    Duration (minutes)
                    <input
                      type="number"
                      min={15}
                      step={15}
                      value={draft.durationMinutes}
                      onChange={(event) => setDraft((current) => ({ ...current, durationMinutes: event.target.value }))}
                      list="workshop-calendar-duration-presets"
                      disabled={saving || Boolean(calendarDay?.isClosed)}
                    />
                    <datalist id="workshop-calendar-duration-presets">
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
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void saveSchedule()}
                    disabled={saving || Boolean(calendarDay?.isClosed)}
                  >
                    {saving ? "Saving..." : selectedJob.scheduledStartAt ? "Save Schedule" : "Schedule Job"}
                  </button>
                  {selectedJob.scheduledStartAt ? (
                    <button type="button" onClick={() => void clearSchedule()} disabled={saving}>
                      Clear Timed Slot
                    </button>
                  ) : null}
                  <Link to={selectedJob.jobPath} className="button-link">
                    Open Job
                  </Link>
                </div>
              </div>
            ) : (
              <div className="muted-text">
                Select a job from the queue below or use a timed job&apos;s edit action in the grid.
              </div>
            )}
          </section>

          <section className="card workshop-calendar-panel">
            <div className="card-header-row">
              <div>
                <h2>Needs Timed Slot</h2>
                <p className="muted-text">
                  Jobs created through check-in or intake that still need a mechanic and time on the calendar.
                </p>
              </div>
              <span className="stock-badge stock-muted">{unscheduledJobs.length}</span>
            </div>
            <div className="workshop-calendar-queue">
              {unscheduledJobs.length === 0 ? (
                <div className="workshop-calendar-empty">No jobs are waiting for an initial timed slot.</div>
              ) : unscheduledJobs.map((job) => (
                <article key={job.id} className="workshop-calendar-queue-card">
                  <div>
                    <strong>{getJobHeading(job)}</strong>
                    <div className="table-secondary">{workshopRawStatusLabel(job.rawStatus)}</div>
                    <div className="table-secondary">
                      Due date: {job.scheduledDate ? job.scheduledDate.slice(0, 10) : "Not promised yet"}
                    </div>
                  </div>
                  <div className="actions-inline">
                    <button type="button" onClick={() => openEditor(job)}>Schedule</button>
                    <Link to={job.jobPath}>Open</Link>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="card workshop-calendar-panel">
            <div className="card-header-row">
              <div>
                <h2>Timed But Unassigned</h2>
                <p className="muted-text">
                  Jobs that already have a time slot on this day but still need a named mechanic.
                </p>
              </div>
              <span className="stock-badge stock-muted">{unassignedTimedJobs.length}</span>
            </div>
            <div className="workshop-calendar-queue">
              {unassignedTimedJobs.length === 0 ? (
                <div className="workshop-calendar-empty">Every timed slot on this day is already assigned.</div>
              ) : unassignedTimedJobs.map((job) => (
                <article key={job.id} className="workshop-calendar-queue-card">
                  <div>
                    <strong>{getJobHeading(job)}</strong>
                    <div className="table-secondary">
                      {formatOptionalTime(job.scheduledStartAt)}-{formatOptionalTime(job.scheduledEndAt)}
                    </div>
                    <div className="table-secondary">{job.customerName || workshopRawStatusLabel(job.rawStatus)}</div>
                  </div>
                  <div className="actions-inline">
                    <button type="button" onClick={() => openEditor(job)}>Assign</button>
                    <Link to={job.jobPath}>Open</Link>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {calendar?.workshopTimeOff.length ? (
            <section className="card workshop-calendar-panel">
              <div className="card-header-row">
                <div>
                  <h2>Workshop Blocks</h2>
                  <p className="muted-text">Workshop-wide time off and closures for this day.</p>
                </div>
              </div>
              <div className="workshop-calendar-queue">
                {calendar.workshopTimeOff.map((entry) => (
                  <article key={entry.id} className="workshop-calendar-queue-card">
                    <div>
                      <strong>{entry.reason || "Workshop time off"}</strong>
                      <div className="table-secondary">
                        {formatOptionalTime(entry.startAt)}-{formatOptionalTime(entry.endAt)}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
};
