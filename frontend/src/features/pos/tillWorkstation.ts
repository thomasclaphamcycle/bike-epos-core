export type PosTillPointId = "TILL_1" | "TILL_2" | "TILL_3";
export type CardTerminalRouteId = "TERMINAL_A" | "TERMINAL_B";

export type PosWorkstationAssignmentSource = "manual" | "ip-hint" | "legacy";

export type PosWorkstationAssignment = {
  tillPointId: PosTillPointId | null;
  terminalRouteId: CardTerminalRouteId | null;
  terminalRouteOverride: boolean;
  source: PosWorkstationAssignmentSource | null;
  updatedAt: string | null;
};

export const POS_TILL_WORKSTATION_STORAGE_KEY = "corepos.pos.workstation";
const LEGACY_POS_TILL_POINT_STORAGE_KEY = "corepos.pos.tillPointId";

export const CARD_TERMINAL_ROUTES: Array<{
  id: CardTerminalRouteId;
  label: string;
  mockTerminalId: string;
}> = [
  { id: "TERMINAL_A", label: "Terminal A", mockTerminalId: "terminal-a" },
  { id: "TERMINAL_B", label: "Terminal B", mockTerminalId: "terminal-b" },
];

export const POS_TILL_POINTS: Array<{
  id: PosTillPointId;
  label: string;
  defaultTerminalRouteId: CardTerminalRouteId;
}> = [
  { id: "TILL_1", label: "Till Point 1", defaultTerminalRouteId: "TERMINAL_A" },
  { id: "TILL_2", label: "Till Point 2", defaultTerminalRouteId: "TERMINAL_B" },
  { id: "TILL_3", label: "Till Point 3", defaultTerminalRouteId: "TERMINAL_A" },
];

const EMPTY_WORKSTATION_ASSIGNMENT: PosWorkstationAssignment = {
  tillPointId: null,
  terminalRouteId: null,
  terminalRouteOverride: false,
  source: null,
  updatedAt: null,
};

export const isPosTillPointId = (value: string | null | undefined): value is PosTillPointId =>
  POS_TILL_POINTS.some((tillPoint) => tillPoint.id === value);

export const isCardTerminalRouteId = (value: string | null | undefined): value is CardTerminalRouteId =>
  CARD_TERMINAL_ROUTES.some((route) => route.id === value);

export const getPosTillPoint = (id: PosTillPointId) =>
  POS_TILL_POINTS.find((tillPoint) => tillPoint.id === id) ?? POS_TILL_POINTS[0];

export const getCardTerminalRoute = (id: CardTerminalRouteId) =>
  CARD_TERMINAL_ROUTES.find((route) => route.id === id) ?? CARD_TERMINAL_ROUTES[0];

export const getDefaultTerminalRouteIdForTill = (tillPointId: PosTillPointId) =>
  getPosTillPoint(tillPointId).defaultTerminalRouteId;

const safeLocalStorage = () => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const getStoredPosWorkstationAssignment = (): PosWorkstationAssignment => {
  const storage = safeLocalStorage();
  if (!storage) {
    return EMPTY_WORKSTATION_ASSIGNMENT;
  }

  try {
    const stored = storage.getItem(POS_TILL_WORKSTATION_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<PosWorkstationAssignment>;
      const tillPointId = isPosTillPointId(parsed.tillPointId) ? parsed.tillPointId : null;
      const terminalRouteId = isCardTerminalRouteId(parsed.terminalRouteId)
        ? parsed.terminalRouteId
        : tillPointId
          ? getDefaultTerminalRouteIdForTill(tillPointId)
          : null;

      return {
        tillPointId,
        terminalRouteId,
        terminalRouteOverride: Boolean(parsed.terminalRouteOverride),
        source:
          parsed.source === "manual" || parsed.source === "ip-hint" || parsed.source === "legacy"
            ? parsed.source
            : null,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      };
    }

    const legacyTillPointId = storage.getItem(LEGACY_POS_TILL_POINT_STORAGE_KEY);
    if (isPosTillPointId(legacyTillPointId)) {
      return {
        tillPointId: legacyTillPointId,
        terminalRouteId: getDefaultTerminalRouteIdForTill(legacyTillPointId),
        terminalRouteOverride: false,
        source: "legacy",
        updatedAt: null,
      };
    }
  } catch {
    return EMPTY_WORKSTATION_ASSIGNMENT;
  }

  return EMPTY_WORKSTATION_ASSIGNMENT;
};

export const saveStoredPosWorkstationAssignment = (
  assignment: {
    tillPointId: PosTillPointId;
    terminalRouteId?: CardTerminalRouteId | null;
    terminalRouteOverride?: boolean;
    source?: PosWorkstationAssignmentSource;
  },
) => {
  const storage = safeLocalStorage();
  if (!storage) {
    return;
  }

  const terminalRouteId =
    assignment.terminalRouteId ?? getDefaultTerminalRouteIdForTill(assignment.tillPointId);

  storage.setItem(
    POS_TILL_WORKSTATION_STORAGE_KEY,
    JSON.stringify({
      tillPointId: assignment.tillPointId,
      terminalRouteId,
      terminalRouteOverride: Boolean(assignment.terminalRouteOverride),
      source: assignment.source ?? "manual",
      updatedAt: new Date().toISOString(),
    } satisfies PosWorkstationAssignment),
  );
  storage.removeItem(LEGACY_POS_TILL_POINT_STORAGE_KEY);
};

export const clearStoredPosWorkstationAssignment = () => {
  const storage = safeLocalStorage();
  if (!storage) {
    return;
  }
  storage.removeItem(POS_TILL_WORKSTATION_STORAGE_KEY);
  storage.removeItem(LEGACY_POS_TILL_POINT_STORAGE_KEY);
};
