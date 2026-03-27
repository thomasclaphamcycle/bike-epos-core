import { useMemo } from "react";
import {
  workshopRawStatusClass,
  workshopRawStatusLabel,
  workshopRawStatusSurfaceClass,
} from "./status";

type CalendarWorkingHours = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
};

type CalendarAvailability = {
  date: string;
  source: "ROTA" | "WORKSHOP_FALLBACK" | "UNAVAILABLE";
  label: string;
  startTime: string | null;
  endTime: string | null;
};

type CalendarTimeOff = {
  id: string;
  scope: "WORKSHOP" | "STAFF";
  startAt: string;
  endAt: string;
  reason: string | null;
};

type CalendarJob = {
  id: string;
  customerName: string | null;
  bikeDescription: string | null;
  summaryText: string;
  rawStatus: string;
  assignedStaffName: string | null;
  scheduledDate: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
};

type CalendarStaffRow = {
  id: string;
  name: string;
  role: "STAFF" | "MANAGER" | "ADMIN";
  operationalRole: "WORKSHOP" | "SALES" | "ADMIN" | "MIXED" | null;
  workingHours: CalendarWorkingHours[];
  availability: CalendarAvailability[];
  timeOff: CalendarTimeOff[];
  scheduledJobs: CalendarJob[];
};

export type WorkshopOperatingCalendarData = {
  range: {
    timeZone: string;
  };
  days: Array<{
    date: string;
    weekday: string;
    opensAt: string | null;
    closesAt: string | null;
    isClosed: boolean;
    closedReason: string | null;
  }>;
  staff: CalendarStaffRow[];
  unassignedJobs: CalendarJob[];
  unscheduledJobs: CalendarJob[];
};

export type WorkshopCalendarJobPresentation = {
  bikeLabel: string;
  customerLabel: string;
  technicianLabel: string;
  signalLabel: string;
  signalClassName: string;
  urgencyLabel: string | null;
  urgencyClassName: string | null;
};

type WorkshopOperatingCalendarProps = {
  calendar: WorkshopOperatingCalendarData | null;
  loading: boolean;
  selectedTechnicianId: string;
  visibleJobIds: Set<string>;
  presentationByJobId: Map<string, WorkshopCalendarJobPresentation>;
  onSelectJob: (jobId: string) => void;
};

const PX_PER_MINUTE = 1.8;
const DEFAULT_OPEN_MINUTES = 9 * 60;
const DEFAULT_CLOSE_MINUTES = 18 * 60;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

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

const formatClockLabel = (minutes: number) => {
  const clamped = clamp(minutes, 0, (24 * 60) - 1);
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${`${hours}`.padStart(2, "0")}:${`${mins}`.padStart(2, "0")}`;
};

const formatOptionalTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "-";

const formatDisplayDate = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })
    : "";

const formatRoleLabel = (row: CalendarStaffRow) => {
  if (row.operationalRole && row.operationalRole !== "WORKSHOP") {
    return `${row.role} · ${row.operationalRole}`;
  }
  return row.role;
};

const getAvailabilityForDate = (row: CalendarStaffRow, dateKey: string) =>
  row.availability.find((entry) => entry.date === dateKey) ?? null;

const getWorkingHoursForDate = (row: CalendarStaffRow, dateKey: string) =>
  row.workingHours.find((entry) => entry.date === dateKey) ?? null;

const buildTimelineRange = (
  calendarDay: WorkshopOperatingCalendarData["days"][number] | undefined,
) => {
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
    width: Math.max(20, (clippedEnd - clippedStart) * PX_PER_MINUTE),
  };
};

export const WorkshopOperatingCalendar = ({
  calendar,
  loading,
  selectedTechnicianId,
  visibleJobIds,
  presentationByJobId,
  onSelectJob,
}: WorkshopOperatingCalendarProps) => {
  const calendarDay = calendar?.days[0];
  const timeline = useMemo(() => buildTimelineRange(calendarDay), [calendarDay]);
  const timelineWidth = Math.max(860, timeline.totalMinutes * PX_PER_MINUTE);

  const timeLabels = useMemo(() => {
    const labels: Array<{ label: string; left: number }> = [];
    const startHour = Math.floor(timeline.openMinutes / 60) * 60;
    const endHour = Math.ceil(timeline.closeMinutes / 60) * 60;

    for (let minutes = startHour; minutes <= endHour; minutes += 60) {
      labels.push({
        label: formatClockLabel(minutes),
        left: (minutes - timeline.openMinutes) * PX_PER_MINUTE,
      });
    }

    return labels;
  }, [timeline.closeMinutes, timeline.openMinutes]);

  const visibleStaffRows = useMemo(() => {
    if (!calendar) {
      return [];
    }

    const filteredRows = calendar.staff
      .filter((staff) => !selectedTechnicianId || staff.id === selectedTechnicianId)
      .map((staff) => ({
        ...staff,
        scheduledJobs: staff.scheduledJobs.filter((job) => visibleJobIds.has(job.id)),
      }));

    if (selectedTechnicianId) {
      return filteredRows;
    }

    return filteredRows;
  }, [calendar, selectedTechnicianId, visibleJobIds]);

  const visibleUnassignedJobs = useMemo(
    () => (calendar?.unassignedJobs ?? []).filter((job) => visibleJobIds.has(job.id)),
    [calendar?.unassignedJobs, visibleJobIds],
  );

  const visibleUnscheduledJobs = useMemo(
    () => (calendar?.unscheduledJobs ?? []).filter((job) => visibleJobIds.has(job.id)),
    [calendar?.unscheduledJobs, visibleJobIds],
  );

  if (loading && !calendar) {
    return (
      <section className="workshop-os-calendar-shell">
        <div className="workshop-os-empty-card">Loading today&apos;s workshop schedule...</div>
      </section>
    );
  }

  if (!calendar || !calendarDay) {
    return (
      <section className="workshop-os-calendar-shell">
        <div className="workshop-os-empty-card">Today&apos;s workshop schedule is not available yet.</div>
      </section>
    );
  }

  return (
    <section className="workshop-os-calendar-shell">
      <div className="workshop-os-calendar-header">
        <div>
          <h2>Calendar</h2>
          <p className="muted-text">
            Today&apos;s bench view using timed workshop slots and live technician cover.
          </p>
        </div>
        <div className="workshop-os-calendar-header__meta">
          <span className="stock-badge stock-muted">
            {formatDisplayDate(`${calendarDay.date}T12:00:00.000Z`)}
          </span>
          {calendarDay.isClosed ? (
            <span className="status-badge status-info">Store closed</span>
          ) : (
            <span className="stock-badge stock-muted">
              {calendarDay.opensAt || "--:--"}-{calendarDay.closesAt || "--:--"} {calendar.range.timeZone}
            </span>
          )}
        </div>
      </div>

      {calendarDay.isClosed ? (
        <div className="restricted-panel info-panel">
          {calendarDay.closedReason || "Store is closed today, so timed workshop work is not scheduled on the operating screen."}
        </div>
      ) : (
        <div className="workshop-os-calendar-scroll">
          <div className="workshop-os-calendar-grid" style={{ minWidth: `${timelineWidth + 250}px` }}>
            <div className="workshop-os-calendar-grid__header">
              <div className="workshop-os-calendar-grid__staff-col">
                <strong>Technician</strong>
              </div>
              <div className="workshop-os-calendar-grid__time-col" style={{ width: `${timelineWidth}px` }}>
                {timeLabels.map((label) => (
                  <span
                    key={`${label.label}-${label.left}`}
                    className="workshop-os-calendar-grid__time-label mono-text"
                    style={{ left: `${label.left}px` }}
                  >
                    {label.label}
                  </span>
                ))}
              </div>
            </div>

            {visibleStaffRows.length ? visibleStaffRows.map((staff) => {
              const availability = getAvailabilityForDate(staff, calendarDay.date);
              const workingHours = getWorkingHoursForDate(staff, calendarDay.date);
              const workingStart = parseClockMinutes(workingHours?.startTime) ?? timeline.openMinutes;
              const workingEnd = parseClockMinutes(workingHours?.endTime) ?? timeline.closeMinutes;
              const workingBand = workingHours
                ? {
                    left: (workingStart - timeline.openMinutes) * PX_PER_MINUTE,
                    width: Math.max(16, (workingEnd - workingStart) * PX_PER_MINUTE),
                  }
                : null;

              return (
                <div key={staff.id} className="workshop-os-calendar-grid__row">
                  <div className="workshop-os-calendar-grid__staff-col">
                    <div className="workshop-os-calendar-grid__staff-name">{staff.name}</div>
                    <div className="table-secondary">{formatRoleLabel(staff)}</div>
                    <div className="table-secondary">
                      {workingHours ? `${workingHours.startTime}-${workingHours.endTime}` : "No shift window"}
                    </div>
                    <div className="table-secondary">
                      {availability?.label || "Not scheduled in rota"}
                    </div>
                  </div>

                  <div
                    className={`workshop-os-calendar-grid__track${workingHours ? "" : " workshop-os-calendar-grid__track--unavailable"}`}
                    style={{ width: `${timelineWidth}px` }}
                  >
                    {workingBand ? (
                      <div
                        className="workshop-os-calendar-grid__working-band"
                        style={{ left: `${workingBand.left}px`, width: `${workingBand.width}px` }}
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
                          className={`workshop-os-calendar-grid__timeoff workshop-os-calendar-grid__timeoff--${entry.scope.toLowerCase()}`}
                          style={{ left: `${block.left}px`, width: `${block.width}px` }}
                          title={entry.reason || "Workshop block"}
                        >
                          <span>{entry.reason || (entry.scope === "WORKSHOP" ? "Workshop block" : "Time off")}</span>
                        </div>
                      );
                    })}

                    {staff.scheduledJobs.map((job) => {
                      const presentation = presentationByJobId.get(job.id);
                      const block = getVisibleBlock(
                        job.scheduledStartAt,
                        job.scheduledEndAt,
                        timeline.openMinutes,
                        timeline.closeMinutes,
                      );

                      if (!presentation || !block) {
                        return null;
                      }

                      return (
                        <button
                          key={job.id}
                          type="button"
                          className="workshop-os-calendar-job"
                          style={{ left: `${block.left}px`, width: `${block.width}px` }}
                          onClick={() => onSelectJob(job.id)}
                        >
                          <div className="workshop-os-calendar-job__time">
                            {formatOptionalTime(job.scheduledStartAt)}-{formatOptionalTime(job.scheduledEndAt)}
                          </div>
                          <strong>{presentation.bikeLabel}</strong>
                          <span>{presentation.customerLabel}</span>
                          <div className="workshop-os-calendar-job__meta">
                            <span>{presentation.technicianLabel}</span>
                            <span className={presentation.signalClassName}>{presentation.signalLabel}</span>
                            {presentation.urgencyLabel && presentation.urgencyClassName ? (
                              <span className={presentation.urgencyClassName}>{presentation.urgencyLabel}</span>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }) : (
              <div className="workshop-os-empty-card">
                No technician rows match the current workshop controls.
              </div>
            )}

            {visibleUnassignedJobs.length ? (
              <div className="workshop-os-calendar-grid__row">
                <div className="workshop-os-calendar-grid__staff-col">
                  <div className="workshop-os-calendar-grid__staff-name">Unassigned</div>
                  <div className="table-secondary">Timed jobs without a named technician</div>
                </div>

                <div
                  className="workshop-os-calendar-grid__track workshop-os-calendar-grid__track--unavailable"
                  style={{ width: `${timelineWidth}px` }}
                >
                  {visibleUnassignedJobs.map((job) => {
                    const presentation = presentationByJobId.get(job.id);
                    const block = getVisibleBlock(
                      job.scheduledStartAt,
                      job.scheduledEndAt,
                      timeline.openMinutes,
                      timeline.closeMinutes,
                    );

                    if (!presentation || !block) {
                      return null;
                    }

                    return (
                      <button
                        key={job.id}
                        type="button"
                        className="workshop-os-calendar-job workshop-os-calendar-job--unassigned"
                        style={{ left: `${block.left}px`, width: `${block.width}px` }}
                        onClick={() => onSelectJob(job.id)}
                      >
                        <div className="workshop-os-calendar-job__time">
                          {formatOptionalTime(job.scheduledStartAt)}-{formatOptionalTime(job.scheduledEndAt)}
                        </div>
                        <strong>{presentation.bikeLabel}</strong>
                        <span>{presentation.customerLabel}</span>
                        <div className="workshop-os-calendar-job__meta">
                          <span>{presentation.technicianLabel}</span>
                          <span className={presentation.signalClassName}>{presentation.signalLabel}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div className="workshop-os-calendar-footer">
        <article className="workshop-os-calendar-queue-panel">
          <div className="workshop-os-calendar-queue-panel__header">
            <h3>Needs timed slot</h3>
            <span className="stock-badge stock-muted">{visibleUnscheduledJobs.length}</span>
          </div>
          {visibleUnscheduledJobs.length ? (
            <div className="workshop-os-calendar-queue">
              {visibleUnscheduledJobs.slice(0, 5).map((job) => {
                const presentation = presentationByJobId.get(job.id);
                return (
                  <button
                    key={job.id}
                    type="button"
                    className={`workshop-os-calendar-queue-card ${workshopRawStatusSurfaceClass(job.rawStatus)}`}
                    onClick={() => onSelectJob(job.id)}
                  >
                    <strong>{presentation?.bikeLabel || job.bikeDescription || "Workshop job"}</strong>
                    <span>{presentation?.customerLabel || job.customerName || workshopRawStatusLabel(job.rawStatus)}</span>
                    <span className={workshopRawStatusClass(job.rawStatus)}>{workshopRawStatusLabel(job.rawStatus)}</span>
                    <span className="table-secondary">
                      {job.scheduledDate ? `Promised ${formatDisplayDate(job.scheduledDate)}` : "No promised day yet"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="workshop-os-empty-card">No visible jobs are waiting for their first timed slot.</div>
          )}
        </article>

        <article className="workshop-os-calendar-queue-panel">
          <div className="workshop-os-calendar-queue-panel__header">
            <h3>What the calendar shows</h3>
          </div>
          <div className="workshop-os-calendar-legend">
            <span className="stock-badge stock-muted">Today only</span>
            <span className="status-badge status-warning">Approval / due</span>
            <span className="status-badge status-info">Parts / bench state</span>
            <span className="status-badge status-complete">Ready</span>
          </div>
          <p className="muted-text">
            This first pass is a calendar-first operating surface for today&apos;s scheduled work. Use the standalone scheduler for deeper rescheduling and assignment edits.
          </p>
        </article>
      </div>
    </section>
  );
};
