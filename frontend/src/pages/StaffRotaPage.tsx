import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { apiDelete, apiGet, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useAuth } from "../auth/AuthContext";
import { HolidayDecisionModal } from "../components/HolidayDecisionModal";
import { HolidayRequestsPanel, type HolidayRequestItem } from "../components/HolidayRequestsPanel";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SurfaceCard } from "../components/ui/SurfaceCard";

type RotaShiftType = "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOLIDAY";
type RotaEditorShiftValue = RotaShiftType | "OFF";
type RotaAssignmentSource = "MANUAL" | "IMPORT" | "HOLIDAY_APPROVED";
type UserRole = "STAFF" | "MANAGER" | "ADMIN";

type RotaOverviewResponse = {
  selectedPeriodId: string | null;
  periods: Array<{
    id: string;
    label: string;
    startsOn: string;
    endsOn: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
    isCurrent: boolean;
    summary: {
      assignedStaffCount: number;
      assignedDays: number;
      holidayDays: number;
      importedAssignments: number;
      latestImportAt: string | null;
      latestImportBatchKey: string | null;
      latestImportFileName: string | null;
    };
  }>;
  period: null | {
    id: string;
    label: string;
    startsOn: string;
    endsOn: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
    notes: string | null;
    createdAt: string;
    updatedAt: string;
    weeks: Array<{
      weekIndex: number;
      label: string;
      startsOn: string;
      endsOn: string;
    }>;
    days: Array<{
      date: string;
      weekIndex: number;
      weekLabel: string;
      weekday: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY";
      weekdayLabel: string;
      shortDateLabel: string;
      isClosed: boolean;
      closedReason: string | null;
      opensAt: string | null;
      closesAt: string | null;
    }>;
    summary: {
      assignedStaffCount: number;
      assignedDays: number;
      holidayDays: number;
      importedAssignments: number;
      closedDays: number;
      latestImportAt: string | null;
      latestImportBatchKey: string | null;
      latestImportFileName: string | null;
    };
    staffRows: Array<{
      staffId: string;
      name: string;
      role: UserRole;
      cells: Array<{
        assignmentId: string | null;
        date: string;
        shiftType: RotaShiftType | null;
        note: string | null;
        source: RotaAssignmentSource | null;
        rawValue: string | null;
        isClosed: boolean;
        closedReason: string | null;
      }>;
    }>;
  };
};

type HolidayRequestsPayload = {
  scope: "mine" | "all";
  statusFilter: "ALL" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  requests: HolidayRequestItem[];
};

type BankHolidaySyncStatus = {
  region: "england-and-wales" | "scotland" | "northern-ireland";
  regionLabel: string;
  sourceUrl: string;
  lastSyncedAt: string | null;
  lastSyncedByStaffId: string | null;
  lastResult: null | {
    createdCount: number;
    updatedCount: number;
    removedCount: number;
    unchangedCount: number;
    skippedManualCount: number;
    warningCount: number;
  };
  storedCount: number;
  isStale: boolean;
  autoSyncAttempted: boolean;
  autoSyncSucceeded: boolean;
  warning: string | null;
  upcoming: Array<{
    date: string;
    name: string;
  }>;
};

type HolidayRequestFilter = HolidayRequestsPayload["statusFilter"];

type RotaGridCell = NonNullable<RotaOverviewResponse["period"]>["staffRows"][number]["cells"][number];

type SaveRotaAssignmentResponse = {
  assignment: {
    id: string;
    rotaPeriodId: string;
    staffId: string;
    date: string;
    shiftType: RotaShiftType;
    source: RotaAssignmentSource;
  };
  previousSource: RotaAssignmentSource | null;
  replacedHolidayApproved: boolean;
};

type ClearRotaAssignmentResponse = {
  clearedAssignmentId: string;
  staffId: string;
  date: string;
  previousSource: RotaAssignmentSource;
};

type BulkRotaAssignmentResponse = {
  changes: Array<{
    date: string;
    action: "saved" | "cleared" | "unchanged";
    shiftType: RotaShiftType | null;
    previousSource: RotaAssignmentSource | null;
    replacedHolidayApproved: boolean;
  }>;
  summary: {
    savedCount: number;
    clearedCount: number;
    unchangedCount: number;
  };
};

type CreateRotaPeriodResponse = {
  created: boolean;
  rotaPeriod: {
    id: string;
    label: string;
    startsOn: string;
    endsOn: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
    notes: string | null;
  };
};

type OpenEditorContext = {
  cellKey: string;
  rowName: string;
  staffId: string;
  periodId: string;
  cell: RotaGridCell;
};

type RotaViewMode = "planner" | "overview";

type FloatingMenuPosition = {
  top: number;
  left: number;
  placement: "top" | "bottom";
};

type DragCopyState = {
  pointerId: number;
  sourceCellKey: string;
  sourceStaffId: string;
  sourceDate: string;
  sourceDayIndex: number;
  sourceValue: RotaEditorShiftValue;
  sourceValueLabel: string;
  rowName: string;
  periodId: string;
  startClientX: number;
  startClientY: number;
  targetDayIndex: number;
  active: boolean;
};

const ROW_DRAG_THRESHOLD_PX = 8;

const shiftShortLabel = (shiftType: RotaShiftType | null) => {
  if (shiftType === "FULL_DAY") {
    return "Full";
  }
  if (shiftType === "HALF_DAY_AM") {
    return "AM";
  }
  if (shiftType === "HALF_DAY_PM") {
    return "PM";
  }
  if (shiftType === "HOLIDAY") {
    return "Holiday";
  }
  return "Off";
};

const SHIFT_OPTIONS: Array<{ value: RotaEditorShiftValue; label: string; shortLabel: string }> = [
  { value: "FULL_DAY", label: "Full Day", shortLabel: "Full" },
  { value: "HALF_DAY_AM", label: "AM", shortLabel: "AM" },
  { value: "HALF_DAY_PM", label: "PM", shortLabel: "PM" },
  { value: "OFF", label: "Off", shortLabel: "Off" },
  { value: "HOLIDAY", label: "Holiday", shortLabel: "Holiday" },
];

const sourceLabel = (source: RotaAssignmentSource | null) => {
  if (source === "IMPORT") {
    return "Imported";
  }
  if (source === "HOLIDAY_APPROVED") {
    return "Holiday approved";
  }
  if (source === "MANUAL") {
    return "Manual";
  }
  return null;
};

const visibleSourceLabel = (source: RotaAssignmentSource | null) => {
  if (source === "IMPORT") {
    return "Imported";
  }
  if (source === "HOLIDAY_APPROVED") {
    return "Holiday approved";
  }
  return null;
};

const shiftClassName = (shiftType: RotaShiftType | null) => {
  if (shiftType === "FULL_DAY") {
    return "rota-shift-pill rota-shift-pill-full";
  }
  if (shiftType === "HALF_DAY_AM") {
    return "rota-shift-pill rota-shift-pill-am";
  }
  if (shiftType === "HALF_DAY_PM") {
    return "rota-shift-pill rota-shift-pill-pm";
  }
  if (shiftType === "HOLIDAY") {
    return "rota-shift-pill rota-shift-pill-holiday";
  }
  return "rota-shift-pill rota-shift-pill-off";
};

const editorValueLabel = (value: RotaEditorShiftValue) =>
  SHIFT_OPTIONS.find((option) => option.value === value)?.label ?? value;

const getCellEditorValue = (cell: RotaGridCell): RotaEditorShiftValue => cell.shiftType ?? "OFF";

const addDaysToDateKey = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const toMondayDateKey = (date: string) => {
  const value = new Date(`${date}T12:00:00.000Z`);
  const weekday = value.getUTCDay();
  const mondayDelta = weekday === 0 ? -6 : 1 - weekday;
  value.setUTCDate(value.getUTCDate() + mondayDelta);
  return value.toISOString().slice(0, 10);
};

const getDefaultCreatePeriodStart = (periods: RotaOverviewResponse["periods"] | undefined) => {
  if (!periods?.length) {
    return toMondayDateKey(new Date().toISOString().slice(0, 10));
  }

  const latestEndsOn = periods.reduce((current, period) => (
    period.endsOn > current ? period.endsOn : current
  ), periods[0].endsOn);

  return addDaysToDateKey(latestEndsOn, 1);
};

const getDefaultWeekIndex = (period: NonNullable<RotaOverviewResponse["period"]>) => {
  const today = new Date().toISOString().slice(0, 10);
  if (today < period.startsOn || today > period.endsOn) {
    return 0;
  }

  const start = new Date(`${period.startsOn}T00:00:00.000Z`);
  const current = new Date(`${today}T00:00:00.000Z`);
  const diffDays = Math.floor((current.getTime() - start.getTime()) / 86_400_000);
  return Math.max(0, Math.min(period.weeks.length - 1, Math.floor(diffDays / 7)));
};

const formatDateTime = (value: string | null) => {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const HOLIDAY_REQUEST_FILTERS: Array<{ value: HolidayRequestFilter; label: string }> = [
  { value: "PENDING", label: "Pending" },
  { value: "ALL", label: "All" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Cancelled" },
];

const OVERVIEW_WEEK_ORDER = [0, 3, 1, 4, 2, 5];

export const StaffRotaPage = () => {
  const { user } = useAuth();
  const { error, success } = useToasts();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overview, setOverview] = useState<RotaOverviewResponse | null>(null);
  const [holidayRequests, setHolidayRequests] = useState<HolidayRequestItem[]>([]);
  const [holidayRequestsLoading, setHolidayRequestsLoading] = useState(true);
  const [holidayRequestFilter, setHolidayRequestFilter] = useState<HolidayRequestFilter>("PENDING");
  const [holidayRequestBusyId, setHolidayRequestBusyId] = useState<string | null>(null);
  const [decisionModalState, setDecisionModalState] = useState<{
    mode: "approve" | "reject";
    request: HolidayRequestItem;
  } | null>(null);
  const [openEditorCellKey, setOpenEditorCellKey] = useState<string | null>(null);
  const [savingCellKey, setSavingCellKey] = useState<string | null>(null);
  const [bulkSavingStaffId, setBulkSavingStaffId] = useState<string | null>(null);
  const [createPeriodStartsOn, setCreatePeriodStartsOn] = useState("");
  const [createPeriodLoading, setCreatePeriodLoading] = useState(false);
  const [bankHolidayStatus, setBankHolidayStatus] = useState<BankHolidaySyncStatus | null>(null);
  const [bankHolidayStatusLoading, setBankHolidayStatusLoading] = useState(false);
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(0);
  const [viewMode, setViewMode] = useState<RotaViewMode>("planner");
  const [floatingMenuPosition, setFloatingMenuPosition] = useState<FloatingMenuPosition | null>(null);
  const [dragCopyState, setDragCopyState] = useState<DragCopyState | null>(null);
  const cellTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const floatingMenuRef = useRef<HTMLDivElement | null>(null);
  const dragCopyStateRef = useRef<DragCopyState | null>(null);
  const suppressCellClickRef = useRef(false);
  const loadOverviewRequestIdRef = useRef(0);
  const loadHolidayRequestsRequestIdRef = useRef(0);

  const selectedPeriodId = searchParams.get("periodId") ?? undefined;
  const staffScope = searchParams.get("staffScope") === "assigned" ? "assigned" : "all";
  const roleFilter = searchParams.get("role") ?? "ALL";
  const searchFilter = searchParams.get("search") ?? "";
  const isAdmin = user?.role === "ADMIN";
  const canEditGrid = user?.role === "MANAGER" || user?.role === "ADMIN";

  const updateQueryParam = (key: string, value: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (!value.trim() || value === "ALL" || value === "all") {
      nextParams.delete(key);
    } else {
      nextParams.set(key, value);
    }
    setSearchParams(nextParams);
  };

  const loadOverview = async (periodId?: string, silent = false) => {
    const requestId = ++loadOverviewRequestIdRef.current;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const query = new URLSearchParams();
      if (periodId?.trim()) {
        query.set("periodId", periodId.trim());
      }
      if (staffScope === "all") {
        query.set("staffScope", "all");
      }
      if (roleFilter !== "ALL") {
        query.set("role", roleFilter);
      }
      if (searchFilter.trim()) {
        query.set("search", searchFilter.trim());
      }
      const payload = await apiGet<RotaOverviewResponse>(`/api/rota${query.toString() ? `?${query.toString()}` : ""}`);
      if (requestId !== loadOverviewRequestIdRef.current) {
        return;
      }
      setOverview(payload);
    } catch (loadError) {
      if (requestId !== loadOverviewRequestIdRef.current) {
        return;
      }
      error(loadError instanceof Error ? loadError.message : "Failed to load staff rota");
    } finally {
      if (requestId === loadOverviewRequestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const loadHolidayRequests = async (silent = false) => {
    const requestId = ++loadHolidayRequestsRequestIdRef.current;
    if (!silent) {
      setHolidayRequestsLoading(true);
    }

    try {
      const query = new URLSearchParams({
        scope: "all",
        status: holidayRequestFilter,
      });
      const payload = await apiGet<HolidayRequestsPayload>(`/api/rota/holiday-requests?${query.toString()}`);
      if (requestId !== loadHolidayRequestsRequestIdRef.current) {
        return;
      }
      setHolidayRequests(payload.requests ?? []);
    } catch (loadError) {
      if (requestId !== loadHolidayRequestsRequestIdRef.current) {
        return;
      }
      error(loadError instanceof Error ? loadError.message : "Failed to load holiday requests");
    } finally {
      if (requestId === loadHolidayRequestsRequestIdRef.current) {
        setHolidayRequestsLoading(false);
      }
    }
  };

  const loadBankHolidayStatus = async (silent = false) => {
    if (!silent) {
      setBankHolidayStatusLoading(true);
    }

    try {
      const payload = await apiGet<BankHolidaySyncStatus>("/api/rota/bank-holidays/status?autoSync=1");
      setBankHolidayStatus(payload);
      if (payload.warning) {
        error(payload.warning);
      }
      if (payload.autoSyncSucceeded) {
        await loadOverview(selectedPeriodId, true);
      }
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load bank holiday status");
    } finally {
      setBankHolidayStatusLoading(false);
    }
  };

  useEffect(() => {
    setOpenEditorCellKey(null);
    void loadOverview(selectedPeriodId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodId, staffScope, roleFilter, searchFilter]);

  useEffect(() => {
    void loadBankHolidayStatus(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    loadOverviewRequestIdRef.current += 1;
    loadHolidayRequestsRequestIdRef.current += 1;
  }, []);

  useEffect(() => {
    void loadHolidayRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holidayRequestFilter]);

  useEffect(() => {
    setCreatePeriodStartsOn(getDefaultCreatePeriodStart(overview?.periods));
  }, [overview?.periods]);

  const currentPeriod = overview?.period ?? null;
  useEffect(() => {
    if (!currentPeriod) {
      setSelectedWeekIndex(0);
      return;
    }

    setSelectedWeekIndex((current) => (
      currentPeriod.weeks[current] ? current : getDefaultWeekIndex(currentPeriod)
    ));
  }, [currentPeriod]);

  const currentPeriodIndex = useMemo(() => (
    overview?.periods.findIndex((period) => period.id === (currentPeriod?.id ?? overview?.selectedPeriodId)) ?? -1
  ), [currentPeriod?.id, overview?.periods, overview?.selectedPeriodId]);
  const visibleStaffCount = currentPeriod?.staffRows.length ?? 0;
  const unassignedVisibleStaffCount = useMemo(
    () => currentPeriod?.staffRows.filter((row) => !row.cells.some((cell) => cell.shiftType)).length ?? 0,
    [currentPeriod],
  );

  const previousPeriod = currentPeriodIndex > 0 ? overview?.periods[currentPeriodIndex - 1] ?? null : null;
  const nextPeriod = currentPeriodIndex >= 0 && overview ? overview.periods[currentPeriodIndex + 1] ?? null : null;
  const selectedWeek = currentPeriod?.weeks[selectedWeekIndex] ?? null;
  const canGoToPreviousWeek = selectedWeekIndex > 0;
  const canGoToNextWeek = currentPeriod ? selectedWeekIndex < currentPeriod.weeks.length - 1 : false;
  const todayDateKey = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const visibleDayIndices = useMemo(() => (
    currentPeriod?.days.reduce<number[]>((indices, day, index) => {
      if (day.weekIndex === selectedWeekIndex) {
        indices.push(index);
      }
      return indices;
    }, []) ?? []
  ), [currentPeriod?.days, selectedWeekIndex]);
  const visibleDays = useMemo(
    () => visibleDayIndices
      .map((index) => currentPeriod?.days[index] ?? null)
      .filter((day): day is NonNullable<RotaOverviewResponse["period"]>["days"][number] => day !== null),
    [currentPeriod?.days, visibleDayIndices],
  );
  const overviewWeeks = useMemo(() => {
    if (!currentPeriod) {
      return [];
    }

    const orderedWeeks = OVERVIEW_WEEK_ORDER
      .map((weekIndex) => currentPeriod.weeks.find((week) => week.weekIndex === weekIndex) ?? null)
      .filter((week): week is NonNullable<RotaOverviewResponse["period"]>["weeks"][number] => week !== null);

    return orderedWeeks.map((week) => {
      const dayIndices = currentPeriod.days.reduce<number[]>((indices, day, index) => {
        if (day.weekIndex === week.weekIndex) {
          indices.push(index);
        }
        return indices;
      }, []);

      return {
        week,
        dayIndices,
        days: dayIndices.map((index) => currentPeriod.days[index]),
      };
    });
  }, [currentPeriod]);
  const openEditorContext = useMemo<OpenEditorContext | null>(() => {
    if (!currentPeriod || !openEditorCellKey) {
      return null;
    }

    for (const row of currentPeriod.staffRows) {
      for (const dayIndex of visibleDayIndices) {
        const cell = row.cells[dayIndex];
        const cellKey = `${row.staffId}-${cell.date}`;
        if (cellKey === openEditorCellKey) {
          return {
            cellKey,
            rowName: row.name,
            staffId: row.staffId,
            periodId: currentPeriod.id,
            cell,
          };
        }
      }
    }

    return null;
  }, [currentPeriod, openEditorCellKey, visibleDayIndices]);

  useEffect(() => {
    setFloatingMenuPosition(null);
  }, [openEditorCellKey]);

  useEffect(() => {
    if (!openEditorContext) {
      setFloatingMenuPosition(null);
      return;
    }

    const closeOnPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const trigger = cellTriggerRefs.current.get(openEditorContext.cellKey) ?? null;
      if (trigger?.contains(target) || floatingMenuRef.current?.contains(target)) {
        return;
      }

      setOpenEditorCellKey(null);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenEditorCellKey(null);
      }
    };

    document.addEventListener("mousedown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [openEditorContext]);

  useLayoutEffect(() => {
    if (!openEditorContext) {
      return undefined;
    }

    let frameId = 0;

    const updateFloatingMenuPosition = () => {
      const trigger = cellTriggerRefs.current.get(openEditorContext.cellKey);
      const menu = floatingMenuRef.current;
      if (!trigger || !menu) {
        return;
      }

      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const gap = 6;
      const margin = 8;
      const spaceBelow = viewportHeight - triggerRect.bottom - margin;
      const fitsBelow = spaceBelow >= menuRect.height || triggerRect.top < menuRect.height + gap + margin;
      const placement: "top" | "bottom" = fitsBelow ? "bottom" : "top";
      const top = placement === "bottom"
        ? Math.min(viewportHeight - menuRect.height - margin, triggerRect.bottom + gap)
        : Math.max(margin, triggerRect.top - menuRect.height - gap);
      const unclampedLeft = triggerRect.left;
      const left = Math.max(
        margin,
        Math.min(unclampedLeft, viewportWidth - menuRect.width - margin),
      );

      setFloatingMenuPosition({ top, left, placement });
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateFloatingMenuPosition);
    };

    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [openEditorContext]);

  const goToPeriod = (periodId: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("periodId", periodId);
    setSearchParams(nextParams);
  };

  const goToPreviousWeek = () => {
    setSelectedWeekIndex((current) => Math.max(0, current - 1));
  };

  const goToNextWeek = () => {
    if (!currentPeriod) {
      return;
    }

    setSelectedWeekIndex((current) => Math.min(currentPeriod.weeks.length - 1, current + 1));
  };

  const createPeriod = async () => {
    if (!createPeriodStartsOn.trim()) {
      error("Choose a Monday start date for the rota period");
      return;
    }

    setCreatePeriodLoading(true);
    try {
      const result = await apiPost<CreateRotaPeriodResponse>("/api/rota/periods", {
        startsOn: createPeriodStartsOn,
      });
      success(result.created ? "Rota period created." : "Rota period already existed.");
      goToPeriod(result.rotaPeriod.id);
      await loadOverview(result.rotaPeriod.id, true);
    } catch (createError) {
      error(createError instanceof Error ? createError.message : "Failed to create rota period");
    } finally {
      setCreatePeriodLoading(false);
    }
  };

  const emptyState = !loading && !currentPeriod;
  const holidayRequestFilterOptions = useMemo(() => HOLIDAY_REQUEST_FILTERS.map((filter) => ({
    value: filter.value,
    label: filter.value === holidayRequestFilter
      ? `${filter.label} (${holidayRequests.length})`
      : filter.label,
  })), [holidayRequestFilter, holidayRequests.length]);

  const submitDecision = async (decisionNotes: string) => {
    if (!decisionModalState) {
      return;
    }

    setHolidayRequestBusyId(decisionModalState.request.id);
    try {
      if (decisionModalState.mode === "approve") {
        await apiPost(`/api/rota/holiday-requests/${encodeURIComponent(decisionModalState.request.id)}/approve`, {
          decisionNotes,
        });
        success("Holiday request approved.");
        await Promise.all([
          loadHolidayRequests(true),
          loadOverview(selectedPeriodId, true),
        ]);
      } else {
        await apiPost(`/api/rota/holiday-requests/${encodeURIComponent(decisionModalState.request.id)}/reject`, {
          decisionNotes,
        });
        success("Holiday request rejected.");
        await loadHolidayRequests(true);
      }
      setDecisionModalState(null);
    } catch (decisionError) {
      error(decisionError instanceof Error ? decisionError.message : "Failed to update holiday request");
    } finally {
      setHolidayRequestBusyId(null);
    }
  };

  const confirmHolidayApprovedOverride = (
    cell: RotaGridCell,
    actionLabel: string,
  ) => {
    if (cell.source !== "HOLIDAY_APPROVED") {
      return true;
    }

    return window.confirm(
      `${actionLabel}?\n\nThis rota cell came from an approved holiday request. The request record will stay approved, but the live rota assignment will be replaced manually.`,
    );
  };

  const saveCellAssignment = async (
    input: {
      rotaPeriodId: string;
      staffId: string;
      date: string;
      shiftType: RotaShiftType;
    },
    cellKey: string,
  ) => {
    setSavingCellKey(cellKey);
    try {
      const result = await apiPost<SaveRotaAssignmentResponse>("/api/rota/assignments", input);
      setOpenEditorCellKey(null);
      await loadOverview(selectedPeriodId, true);
      success(
        result.replacedHolidayApproved
          ? "Saved manual rota override."
          : "Rota assignment saved.",
      );
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save rota assignment");
    } finally {
      setSavingCellKey(null);
    }
  };

  const clearCellAssignment = async (assignmentId: string, cellKey: string) => {
    setSavingCellKey(cellKey);
    try {
      await apiDelete<ClearRotaAssignmentResponse>(`/api/rota/assignments/${encodeURIComponent(assignmentId)}`);
      setOpenEditorCellKey(null);
      await loadOverview(selectedPeriodId, true);
      success("Rota assignment cleared.");
    } catch (clearError) {
      error(clearError instanceof Error ? clearError.message : "Failed to clear rota assignment");
    } finally {
      setSavingCellKey(null);
    }
  };

  const applyEditorShift = async (
    input: {
      rotaPeriodId: string;
      staffId: string;
      date: string;
    },
    cell: RotaGridCell,
    cellKey: string,
    value: RotaEditorShiftValue,
  ) => {
    if (value === "OFF") {
      if (!cell.assignmentId) {
        setOpenEditorCellKey(null);
        return;
      }
      if (!confirmHolidayApprovedOverride(cell, "Mark this day as Off")) {
        return;
      }
      await clearCellAssignment(cell.assignmentId, cellKey);
      return;
    }

    if (!confirmHolidayApprovedOverride(cell, `Replace with ${SHIFT_OPTIONS.find((option) => option.value === value)?.label ?? value}`)) {
      return;
    }

    await saveCellAssignment(
      {
        ...input,
        shiftType: value,
      },
      cellKey,
    );
  };

  useEffect(() => {
    dragCopyStateRef.current = dragCopyState;
  }, [dragCopyState]);

  const applyBulkAssignments = async (
    input: {
      rotaPeriodId: string;
      staffId: string;
      changes: Array<{
        date: string;
        shiftType: RotaEditorShiftValue;
      }>;
    },
    options: {
      successMessage: (result: BulkRotaAssignmentResponse) => string;
      failureMessage: string;
    },
  ) => {
    if (input.changes.length === 0) {
      return;
    }

    setOpenEditorCellKey(null);
    setBulkSavingStaffId(input.staffId);
    try {
      const result = await apiPost<BulkRotaAssignmentResponse>("/api/rota/assignments/bulk", input);
      await loadOverview(selectedPeriodId, true);
      success(options.successMessage(result));
    } catch (bulkSaveError) {
      error(bulkSaveError instanceof Error ? bulkSaveError.message : options.failureMessage);
    } finally {
      setBulkSavingStaffId(null);
    }
  };

  const handleCellTriggerClick = (cellKey: string) => {
    if (suppressCellClickRef.current) {
      suppressCellClickRef.current = false;
      return;
    }

    setOpenEditorCellKey((current) => current === cellKey ? null : cellKey);
  };

  const handleCellTriggerDoubleClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    input: {
      rotaPeriodId: string;
      staffId: string;
      cellKey: string;
      cell: RotaGridCell;
    },
  ) => {
    if (!canEditGrid || savingCellKey === input.cellKey || bulkSavingStaffId === input.staffId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressCellClickRef.current = false;
    setOpenEditorCellKey(null);

    const nextValue: RotaEditorShiftValue = input.cell.shiftType === "FULL_DAY" ? "OFF" : "FULL_DAY";
    void applyEditorShift(
      {
        rotaPeriodId: input.rotaPeriodId,
        staffId: input.staffId,
        date: input.cell.date,
      },
      input.cell,
      input.cellKey,
      nextValue,
    );
  };

  const beginRowDragCopy = (
    event: React.PointerEvent<HTMLButtonElement>,
    input: {
      rowName: string;
      staffId: string;
      cellKey: string;
      date: string;
      dayIndex: number;
      periodId: string;
      value: RotaEditorShiftValue;
    },
  ) => {
    if (
      event.button !== 0
      || !canEditGrid
      || savingCellKey === input.cellKey
      || bulkSavingStaffId === input.staffId
    ) {
      return;
    }

    setDragCopyState({
      pointerId: event.pointerId,
      sourceCellKey: input.cellKey,
      sourceStaffId: input.staffId,
      sourceDate: input.date,
      sourceDayIndex: input.dayIndex,
      sourceValue: input.value,
      sourceValueLabel: editorValueLabel(input.value),
      rowName: input.rowName,
      periodId: input.periodId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      targetDayIndex: input.dayIndex,
      active: false,
    });
  };

  const fillWeekdaysForRow = async (
    row: NonNullable<RotaOverviewResponse["period"]>["staffRows"][number],
  ) => {
    if (!currentPeriod) {
      return;
    }

    const weekdayChanges = visibleDayIndices
      .map((dayIndex) => ({
        cell: row.cells[dayIndex],
        day: currentPeriod.days[dayIndex],
      }))
      .filter(({ cell, day }) => !cell.isClosed && day.weekday !== "SATURDAY")
      .map(({ cell }) => ({
        date: cell.date,
        shiftType: "FULL_DAY" as const,
      }));

    if (weekdayChanges.length === 0) {
      error("No open Monday to Friday days are available in this week.");
      return;
    }

    await applyBulkAssignments(
      {
        rotaPeriodId: currentPeriod.id,
        staffId: row.staffId,
        changes: weekdayChanges,
      },
      {
        successMessage: (result) => {
          if (result.summary.savedCount === 0 && result.summary.unchangedCount > 0) {
            return "Monday to Friday already matched the default shift.";
          }
          return `Filled Monday to Friday for ${row.name}.`;
        },
        failureMessage: "Failed to fill Monday to Friday shifts",
      },
    );
  };

  useEffect(() => {
    if (!dragCopyState) {
      return;
    }

    document.body.classList.add("rota-row-drag-copy-active");

    const handlePointerMove = (event: PointerEvent) => {
      const current = dragCopyStateRef.current;
      if (!current || event.pointerId !== current.pointerId) {
        return;
      }

      const nextActive = current.active
        || Math.max(
          Math.abs(event.clientX - current.startClientX),
          Math.abs(event.clientY - current.startClientY),
        ) >= ROW_DRAG_THRESHOLD_PX;

      if (!nextActive) {
        return;
      }

      const hoveredElement = document.elementFromPoint(event.clientX, event.clientY);
      const target = hoveredElement instanceof HTMLElement
        ? hoveredElement.closest<HTMLElement>("[data-rota-cell-trigger='true']")
        : null;
      const targetStaffId = target?.dataset.rotaStaffId ?? null;
      const nextDayIndex = Number.parseInt(target?.dataset.rotaDayIndex ?? "", 10);

      event.preventDefault();

      if (targetStaffId !== current.sourceStaffId || Number.isNaN(nextDayIndex)) {
        setDragCopyState({
          ...current,
          active: true,
        });
        return;
      }

      if (current.active && current.targetDayIndex === nextDayIndex) {
        return;
      }

      setDragCopyState({
        ...current,
        active: true,
        targetDayIndex: nextDayIndex,
      });
    };

    const handlePointerFinish = (event: PointerEvent) => {
      const current = dragCopyStateRef.current;
      if (!current || event.pointerId !== current.pointerId) {
        return;
      }

      document.body.classList.remove("rota-row-drag-copy-active");
      setDragCopyState(null);

      if (!current.active || !currentPeriod) {
        return;
      }

      suppressCellClickRef.current = true;

      const sourceRow = currentPeriod.staffRows.find((row) => row.staffId === current.sourceStaffId);
      if (!sourceRow) {
        return;
      }

      const startIndex = Math.min(current.sourceDayIndex, current.targetDayIndex);
      const endIndex = Math.max(current.sourceDayIndex, current.targetDayIndex);
      const changes = visibleDayIndices
        .filter((dayIndex) => dayIndex >= startIndex && dayIndex <= endIndex)
        .map((dayIndex) => sourceRow.cells[dayIndex])
        .filter((cell) => !cell.isClosed && cell.date !== current.sourceDate)
        .map((cell) => ({
          date: cell.date,
          shiftType: current.sourceValue,
        }));

      if (changes.length === 0) {
        return;
      }

      void applyBulkAssignments(
        {
          rotaPeriodId: current.periodId,
          staffId: current.sourceStaffId,
          changes,
        },
        {
          successMessage: (result) => {
            const changedCount = result.summary.savedCount + result.summary.clearedCount;
            if (changedCount === 0) {
              return `${current.rowName} already matched ${current.sourceValueLabel.toLowerCase()} across that range.`;
            }
            return `Copied ${current.sourceValueLabel.toLowerCase()} across ${changedCount} ${changedCount === 1 ? "day" : "days"} for ${current.rowName}.`;
          },
          failureMessage: "Failed to copy the rota shift across the row",
        },
      );
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerFinish);
    window.addEventListener("pointercancel", handlePointerFinish);
    return () => {
      document.body.classList.remove("rota-row-drag-copy-active");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerFinish);
      window.removeEventListener("pointercancel", handlePointerFinish);
    };
  }, [canEditGrid, bulkSavingStaffId, currentPeriod, dragCopyState, error, selectedPeriodId, success, visibleDayIndices]);

  return (
    <div className="page-shell page-shell-workspace ui-page ui-page--workspace rota-page">
      <SurfaceCard tone="soft">
        <PageHeader
          title="Rota"
          actions={(
            <div className="actions-inline">
              <button
                type="button"
                onClick={() => {
                  void loadOverview(selectedPeriodId, true);
                  void loadBankHolidayStatus(true);
                }}
                disabled={loading || refreshing || bankHolidayStatusLoading}
              >
                {refreshing || bankHolidayStatusLoading ? "Refreshing..." : "Refresh"}
              </button>
              <button type="button" onClick={() => window.print()} disabled={!currentPeriod}>Print view</button>
              <Link to="/dashboard" className="button-link">Dashboard</Link>
              {canEditGrid ? <Link to="/management/staff-rota/tools" className="button-link">Rota Tools</Link> : null}
              {isAdmin ? <Link to="/settings/staff-list" className="button-link">Staff List</Link> : null}
              {isAdmin ? <Link to="/settings/roles-permissions" className="button-link">Roles & Permissions</Link> : null}
            </div>
          )}
        />

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Selected Period</span>
            <strong className="metric-value">{currentPeriod ? currentPeriod.label : "No rota loaded"}</strong>
            <span className="dashboard-metric-detail">Six-week rota periods stay reusable whether they were created in-app or imported.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Assigned Staff</span>
            <strong className="metric-value">{currentPeriod ? currentPeriod.summary.assignedStaffCount : 0}</strong>
            <span className="dashboard-metric-detail">People with at least one assignment in this period.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Assigned Days</span>
            <strong className="metric-value">{currentPeriod ? currentPeriod.summary.assignedDays : 0}</strong>
            <span className="dashboard-metric-detail">Scheduled non-holiday assignments across editable Monday to Saturday trading days.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Planning Source</span>
            <strong className="metric-value">{currentPeriod?.summary.latestImportFileName ?? "Created in CorePOS"}</strong>
            <span className="dashboard-metric-detail">
              {currentPeriod?.summary.latestImportAt
                ? `Latest import updated ${formatDateTime(currentPeriod.summary.latestImportAt)}`
                : "Cells default to Off until you assign Full Day, AM, PM, or Holiday."}
            </span>
          </div>
        </div>

        {bankHolidayStatus?.warning || (bankHolidayStatus?.isStale && bankHolidayStatus.storedCount === 0) ? (
          <div className="restricted-panel warning-panel">
            <strong>Bank holiday sync needs attention.</strong>
            <span>
              {bankHolidayStatus.warning
                ?? `No future ${bankHolidayStatus.regionLabel} bank holidays are currently stored for the rota. Open Rota Tools to review the sync.`}
            </span>
          </div>
        ) : null}
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader
          title="Weekly Editor"
          actions={(
            <div className="actions-inline rota-period-controls">
            <div className="rota-view-toggle" role="tablist" aria-label="Rota view mode">
              <button
                type="button"
                className={viewMode === "planner" ? "is-active" : ""}
                aria-pressed={viewMode === "planner"}
                onClick={() => setViewMode("planner")}
              >
                Planner View
              </button>
              <button
                type="button"
                className={viewMode === "overview" ? "is-active" : ""}
                aria-pressed={viewMode === "overview"}
                onClick={() => setViewMode("overview")}
              >
                6 Week Overview
              </button>
            </div>
            <button type="button" onClick={() => previousPeriod && goToPeriod(previousPeriod.id)} disabled={!previousPeriod}>
              Previous
            </button>
            <label className="rota-period-select">
              <span className="sr-only">Select rota period</span>
              <select
                value={currentPeriod?.id ?? overview?.selectedPeriodId ?? ""}
                onChange={(event) => goToPeriod(event.target.value)}
                disabled={!overview?.periods.length}
              >
                {overview?.periods.length ? overview.periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label}{period.isCurrent ? " · Current" : ""}
                  </option>
                )) : (
                  <option value="">No periods</option>
                )}
              </select>
            </label>
            <button type="button" onClick={() => nextPeriod && goToPeriod(nextPeriod.id)} disabled={!nextPeriod}>
              Next
            </button>
            </div>
          )}
        />

        {canEditGrid ? (
          <div className="rota-create-panel">
            <div>
              <strong>Create six-week rota period</strong>
              <p className="muted-text">
                Start on a Monday. Sunday stays closed, and store opening hours plus bank-holiday closures are reused automatically.
              </p>
            </div>
            <div className="rota-create-controls">
              <label>
                Start Monday
                <input
                  type="date"
                  value={createPeriodStartsOn}
                  onChange={(event) => setCreatePeriodStartsOn(event.target.value)}
                  disabled={createPeriodLoading}
                />
              </label>
              <button type="button" className="primary" onClick={() => void createPeriod()} disabled={createPeriodLoading}>
                {createPeriodLoading ? "Creating..." : "Create period"}
              </button>
            </div>
          </div>
        ) : null}

        {emptyState ? (
          <EmptyState
            title="No rota period exists yet."
            description={canEditGrid
              ? "Create the first six-week period above, then fill in weekly assignments directly here. Spreadsheet template, export, and update tools are available from Rota Tools."
              : "Ask a manager or admin to create the first rota period so live staffing can appear on the dashboard and rota pages."}
          />
        ) : currentPeriod ? (
          <>
            <div className="rota-period-summary">
              <div className="rota-period-summary-item">
                <span className="metric-label">Dates</span>
                <strong>{currentPeriod.startsOn} to {currentPeriod.endsOn}</strong>
              </div>
              <div className="rota-period-summary-item">
                <span className="metric-label">Holiday Days</span>
                <strong>{currentPeriod.summary.holidayDays}</strong>
              </div>
              <div className="rota-period-summary-item">
                <span className="metric-label">Closed Days</span>
                <strong>{currentPeriod.summary.closedDays}</strong>
              </div>
              <div className="rota-period-summary-item">
                <span className="metric-label">Store Hours Source</span>
                <strong>Store Info opening hours</strong>
              </div>
              <div className="rota-period-summary-item">
                <span className="metric-label">Visible Staff</span>
                <strong>{visibleStaffCount}</strong>
              </div>
              <div className="rota-period-summary-item">
                <span className="metric-label">Editing Week</span>
                <strong>{viewMode === "overview" ? "All six weeks" : selectedWeek?.label ?? "—"}</strong>
              </div>
            </div>

            <div className="filter-row rota-filter-row">
              <label className="grow">
                Week
                <select
                  value={selectedWeekIndex}
                  onChange={(event) => setSelectedWeekIndex(Number.parseInt(event.target.value, 10))}
                >
                  {currentPeriod.weeks.map((week) => (
                    <option key={week.weekIndex} value={week.weekIndex}>
                      Week {week.weekIndex + 1} · {week.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grow">
                Staff view
                <select
                  value={staffScope}
                  onChange={(event) => updateQueryParam("staffScope", event.target.value)}
                >
                  <option value="all">All active staff</option>
                  <option value="assigned">Assigned staff only</option>
                </select>
              </label>
              <label className="grow">
                Role
                <select
                  value={roleFilter}
                  onChange={(event) => updateQueryParam("role", event.target.value)}
                >
                  <option value="ALL">All roles</option>
                  <option value="STAFF">Staff</option>
                  <option value="MANAGER">Manager</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </label>
              <label className="grow">
                Search staff
                <input
                  type="search"
                  value={searchFilter}
                  placeholder="Search by name"
                  onChange={(event) => updateQueryParam("search", event.target.value)}
                />
              </label>
            </div>

            {unassignedVisibleStaffCount ? (
              <p className="muted-text rota-filter-summary">
                {unassignedVisibleStaffCount} visible {unassignedVisibleStaffCount === 1 ? "person has" : "people have"} no shifts yet.
              </p>
            ) : null}

            {viewMode === "planner" ? (
              <div className="table-wrap rota-grid-wrap">
                <table className="table-primary rota-review-grid">
                  <thead>
                    <tr>
                      <th className="rota-sticky rota-sticky-name" rowSpan={2}>Staff</th>
                      <th className="rota-sticky rota-sticky-role" rowSpan={2}>Role</th>
                      <th colSpan={visibleDays.length}>
                        <div className="rota-week-heading">
                          <button
                            type="button"
                            className="rota-week-heading__nav"
                            onClick={goToPreviousWeek}
                            disabled={!canGoToPreviousWeek}
                            aria-label="Go to previous rota week"
                            data-testid="rota-week-prev"
                          >
                            ←
                          </button>
                          <div className="rota-week-heading__copy" data-testid="rota-week-heading">
                            <strong>Week {selectedWeekIndex + 1}</strong>
                            <span>{selectedWeek?.label ?? "Selected week"}</span>
                          </div>
                          <button
                            type="button"
                            className="rota-week-heading__nav"
                            onClick={goToNextWeek}
                            disabled={!canGoToNextWeek}
                            aria-label="Go to next rota week"
                            data-testid="rota-week-next"
                          >
                            →
                          </button>
                        </div>
                      </th>
                    </tr>
                    <tr>
                      {visibleDays.map((day) => (
                        <th key={day.date} className={day.isClosed ? "rota-day-heading rota-day-heading-closed" : "rota-day-heading"}>
                          <div className="rota-day-heading-copy">
                            <strong>{day.weekdayLabel.slice(0, 3)}</strong>
                            <span>{day.shortDateLabel}</span>
                            {day.isClosed ? (
                              <>
                                <span className="status-badge status-warning">Closed</span>
                                {day.closedReason ? (
                                  <span className="table-secondary rota-day-closed-reason">{day.closedReason}</span>
                                ) : null}
                              </>
                            ) : day.opensAt && day.closesAt ? (
                              <span className="muted-text rota-day-hours">{day.opensAt} - {day.closesAt}</span>
                            ) : null}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {currentPeriod.staffRows.length ? currentPeriod.staffRows.map((row) => (
                      <tr
                        key={row.staffId}
                        data-testid={`rota-row-${row.staffId}`}
                        className={dragCopyState?.sourceStaffId === row.staffId ? "rota-row-drag-scope" : ""}
                      >
                        <th className="rota-sticky rota-sticky-name rota-staff-name" scope="row">
                          <div className="rota-staff-name-copy">
                            <div className="rota-staff-name-main">
                              <div className="rota-staff-name-details">
                                <span>{row.name}</span>
                                {!visibleDayIndices.some((index) => row.cells[index]?.shiftType) ? (
                                  <span className="table-secondary">Off all week in this view</span>
                                ) : null}
                              </div>
                              {canEditGrid ? (
                                <button
                                  type="button"
                                  className="button-link button-link-compact rota-row-quick-action"
                                  data-testid={`rota-fill-weekdays-${row.staffId}`}
                                  onClick={() => void fillWeekdaysForRow(row)}
                                  disabled={bulkSavingStaffId === row.staffId}
                                >
                                  Fill Mon–Fri
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </th>
                        <td className="rota-sticky rota-sticky-role rota-staff-role">
                          <span className="status-badge status-info">{row.role}</span>
                        </td>
                        {visibleDayIndices.map((dayIndex) => {
                          const cell = row.cells[dayIndex];
                          const cellKey = `${row.staffId}-${cell.date}`;
                          const isEditorOpen = openEditorCellKey === cellKey;
                          const isSavingCell = savingCellKey === cellKey;
                          const isBulkSavingRow = bulkSavingStaffId === row.staffId;
                          const cellSourceLabel = sourceLabel(cell.source);
                          const cellVisibleSourceLabel = visibleSourceLabel(cell.source);
                          const isDragSource = dragCopyState?.sourceCellKey === cellKey;
                          const isDragPreview = Boolean(
                            dragCopyState?.active
                            && dragCopyState.sourceStaffId === row.staffId
                            && dayIndex >= Math.min(dragCopyState.sourceDayIndex, dragCopyState.targetDayIndex)
                            && dayIndex <= Math.max(dragCopyState.sourceDayIndex, dragCopyState.targetDayIndex)
                            && !cell.isClosed,
                          );
                          const triggerTitle = cell.isClosed
                            ? cell.closedReason || "Closed"
                            : canEditGrid
                              ? `Edit ${row.name} on ${cell.date}${cellSourceLabel ? ` · ${cellSourceLabel}` : ""}`
                              : cell.note || cell.rawValue || cellSourceLabel || "Rota assignment";

                          return (
                            <td
                              key={cellKey}
                              className={[
                                "rota-cell",
                                cell.isClosed ? "rota-cell-closed" : "",
                                canEditGrid && !cell.isClosed ? "rota-cell-editable" : "",
                                isEditorOpen ? "rota-cell-open" : "",
                                isDragSource ? "rota-cell-drag-source" : "",
                                isDragPreview ? "rota-cell-drag-preview" : "",
                              ].filter(Boolean).join(" ")}
                              title={triggerTitle}
                            >
                              {cell.isClosed ? (
                                <span className="table-secondary">{cell.closedReason ?? "Closed"}</span>
                              ) : (
                                <button
                                  type="button"
                                  className="rota-cell-trigger"
                                  data-rota-cell-trigger="true"
                                  data-rota-staff-id={row.staffId}
                                  data-rota-day-index={String(dayIndex)}
                                  data-testid={`rota-cell-trigger-${row.staffId}-${cell.date}`}
                                  ref={(node) => {
                                    if (node) {
                                      cellTriggerRefs.current.set(cellKey, node);
                                    } else {
                                      cellTriggerRefs.current.delete(cellKey);
                                    }
                                  }}
                                  onPointerDown={(event) => beginRowDragCopy(event, {
                                    rowName: row.name,
                                    staffId: row.staffId,
                                    cellKey,
                                    date: cell.date,
                                    dayIndex,
                                    periodId: currentPeriod.id,
                                    value: getCellEditorValue(cell),
                                  })}
                                  onClick={() => handleCellTriggerClick(cellKey)}
                                  onDoubleClick={(event) => handleCellTriggerDoubleClick(event, {
                                    rotaPeriodId: currentPeriod.id,
                                    staffId: row.staffId,
                                    cellKey,
                                    cell,
                                  })}
                                  disabled={!canEditGrid || isSavingCell || isBulkSavingRow}
                                  aria-expanded={isEditorOpen}
                                  aria-haspopup="menu"
                                >
                                  <div className="rota-cell-content">
                                    <span className={shiftClassName(cell.shiftType)}>
                                      {shiftShortLabel(cell.shiftType)}
                                    </span>
                                    {cell.note ? <span className="muted-text rota-cell-note">{cell.note}</span> : null}
                                    {cellVisibleSourceLabel ? <span className="table-secondary">{cellVisibleSourceLabel}</span> : null}
                                  </div>
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={visibleDays.length + 2}>
                          <EmptyState
                            title="No staff match the current rota filters."
                            description="Adjust staff view, role, or search filters to widen the planner."
                            className="rota-empty-state"
                          />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rota-overview-layout">
                {currentPeriod.staffRows.length ? overviewWeeks.map(({ week, dayIndices, days }) => (
                  <section key={week.weekIndex} className="card rota-overview-week-card">
                    <div className="card-header-row rota-overview-week-header">
                      <div>
                        <h3>Week {week.weekIndex + 1}</h3>
                        <p className="muted-text">
                          Starts {week.startsOn} · {week.label}
                        </p>
                      </div>
                    </div>

                    <div className="table-wrap rota-overview-table-wrap">
                      <table className="table-primary rota-overview-week-grid">
                        <thead>
                          <tr>
                            <th className="rota-overview-staff-heading">Staff</th>
                            {days.map((day) => (
                              <th
                                key={day.date}
                                className={[
                                  "rota-day-heading",
                                  "rota-overview-day-heading",
                                  day.isClosed ? "rota-day-heading-closed rota-overview-day-closed" : "",
                                  day.date === todayDateKey ? "rota-overview-day-today" : "",
                                ].filter(Boolean).join(" ")}
                              >
                                <div className="rota-day-heading-copy">
                                  <strong>{day.weekdayLabel.slice(0, 3)}</strong>
                                  <span>{day.shortDateLabel}</span>
                                  {day.date === todayDateKey ? <span className="status-badge status-info">Today</span> : null}
                                  {day.isClosed ? (
                                    <span className="table-secondary rota-day-closed-reason">{day.closedReason ?? "Closed"}</span>
                                  ) : null}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {currentPeriod.staffRows.map((row) => {
                            const isCurrentUserRow = row.staffId === user?.id;
                            return (
                              <tr key={`${week.weekIndex}-${row.staffId}`} className={isCurrentUserRow ? "rota-overview-row-current-user" : ""}>
                                <th className="rota-staff-name rota-overview-staff-cell" scope="row">
                                  <div className="rota-staff-name-copy">
                                    <span>{row.name}</span>
                                    <span className="table-secondary">
                                      {isCurrentUserRow ? "You" : row.role}
                                    </span>
                                  </div>
                                </th>
                                {dayIndices.map((dayIndex) => {
                                  const cell = row.cells[dayIndex];
                                  return (
                                    <td
                                      key={`${row.staffId}-${cell.date}`}
                                      className={[
                                        "rota-cell",
                                        "rota-overview-cell",
                                        cell.isClosed ? "rota-cell-closed rota-overview-cell-closed" : "",
                                        cell.date === todayDateKey ? "rota-overview-day-today" : "",
                                      ].filter(Boolean).join(" ")}
                                      title={cell.isClosed ? (cell.closedReason ?? "Closed") : `${row.name} · ${cell.date} · ${shiftShortLabel(cell.shiftType)}`}
                                    >
                                      {cell.isClosed ? (
                                        <span className="table-secondary rota-overview-closed-label">{cell.closedReason ?? "Closed"}</span>
                                      ) : (
                                        <div className="rota-overview-cell-content">
                                          <span className={`${shiftClassName(cell.shiftType)} rota-overview-pill`}>
                                            {shiftShortLabel(cell.shiftType)}
                                          </span>
                                          {cell.source === "HOLIDAY_APPROVED" ? (
                                            <span className="table-secondary rota-overview-source">Holiday</span>
                                          ) : null}
                                        </div>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )) : (
                  <EmptyState
                    title="No staff match the current rota filters."
                    description="Adjust staff view, role, or search filters to widen the six-week overview."
                    className="rota-empty-state"
                  />
                )}
              </div>
            )}
          </>
        ) : null}
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader
          title="Holiday Requests"
          description="Keep pending leave decisions close to the planner. Approved requests still write back into the live rota as HOLIDAY assignments."
        />

        <HolidayRequestsPanel
          title="Holiday Requests"
          subtitle="Review pending leave without leaving the planning workspace."
          requests={holidayRequests}
          filterValue={holidayRequestFilter}
          filterOptions={holidayRequestFilterOptions}
          onFilterChange={(value) => setHolidayRequestFilter(value as HolidayRequestFilter)}
          loading={holidayRequestsLoading}
          onApprove={async (request) => {
            setDecisionModalState({
              mode: "approve",
              request,
            });
          }}
          onReject={async (request) => {
            setDecisionModalState({
              mode: "reject",
              request,
            });
          }}
          busyRequestId={holidayRequestBusyId}
          emptyMessage={
            holidayRequestFilter === "PENDING"
              ? "No pending holiday requests need review right now."
              : `No ${holidayRequestFilter.toLowerCase()} holiday requests in this view yet.`
          }
        />
      </SurfaceCard>

      <HolidayDecisionModal
        open={Boolean(decisionModalState)}
        mode={decisionModalState?.mode ?? "approve"}
        request={decisionModalState?.request ?? null}
        submitting={Boolean(holidayRequestBusyId)}
        onClose={() => {
          if (!holidayRequestBusyId) {
            setDecisionModalState(null);
          }
        }}
        onSubmit={submitDecision}
      />
      {openEditorContext ? createPortal(
        <div
          ref={floatingMenuRef}
          className={`rota-cell-popover rota-cell-popover-floating rota-cell-popover-${floatingMenuPosition?.placement ?? "bottom"}`}
          style={{
            top: floatingMenuPosition ? `${floatingMenuPosition.top}px` : "0px",
            left: floatingMenuPosition ? `${floatingMenuPosition.left}px` : "0px",
            visibility: floatingMenuPosition ? "visible" : "hidden",
          }}
          role="menu"
          aria-label={`Edit ${openEditorContext.rowName} on ${openEditorContext.cell.date}`}
        >
          <div className="rota-cell-popover-copy">
            <strong>{openEditorContext.rowName}</strong>
            <span>{openEditorContext.cell.date}</span>
            {sourceLabel(openEditorContext.cell.source) ? (
              <span className="table-secondary">Current source: {sourceLabel(openEditorContext.cell.source)}</span>
            ) : null}
          </div>
          <div className="rota-cell-popover-actions">
            {SHIFT_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="menuitem"
                disabled={savingCellKey === openEditorContext.cellKey}
                onClick={() => {
                  void applyEditorShift(
                    {
                      rotaPeriodId: openEditorContext.periodId,
                      staffId: openEditorContext.staffId,
                      date: openEditorContext.cell.date,
                    },
                    openEditorContext.cell,
                    openEditorContext.cellKey,
                    value,
                  );
                }}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              disabled={savingCellKey === openEditorContext.cellKey}
              onClick={() => setOpenEditorCellKey(null)}
            >
              Cancel
            </button>
          </div>
          {savingCellKey === openEditorContext.cellKey ? <span className="muted-text">Saving...</span> : null}
        </div>,
        document.body,
      ) : null}
    </div>
  );
};
