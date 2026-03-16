import { createHash } from "node:crypto";
import path from "node:path";
import { RotaAssignmentSource, RotaShiftType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { listShopSettings } from "./configurationService";
import { buildSixWeekRotaWindow, getOrCreateSixWeekRotaPeriod, normalizeDateKeyOrThrow } from "./rotaService";
import { resolveStoreDaySchedule } from "./storeScheduleService";
import {
  clockTimeToMinutes,
  formatDateKeyInTimeZone,
  STORE_WEEKDAY_KEYS,
  STORE_WEEKDAY_LABELS,
  type StoreOpeningHoursSettings,
  type StoreWeekdayKey,
} from "../utils/storeHours";
import { HttpError } from "../utils/http";

export type LegacyRotaImportDelimiter = "auto" | "," | "\t" | ";";

type SpreadsheetBlock = {
  blockStartRowIndex: number;
  headerRowIndex: number;
  startCol: number;
  dates: Record<StoreWeekdayKey, string>;
};

type StaffRecord = {
  id: string;
  username: string;
  name: string | null;
  isActive: boolean;
};

type ParsedImportCell = {
  staffId: string;
  staffName: string;
  date: string;
  shiftType: RotaShiftType | null;
  note: string | null;
  rawValue: string;
  rowNumber: number;
};

type ParsedAssignmentsResult = {
  cells: ParsedImportCell[];
  warnings: string[];
  blockingIssues: string[];
  skippedCells: number;
  matchedStaffIds: string[];
};

type PreviewOptions = {
  spreadsheetText?: string;
  fileName?: string;
  delimiter?: LegacyRotaImportDelimiter;
  db?: typeof prisma;
};

type ConfirmOptions = PreviewOptions & {
  previewKey?: string;
  createdByStaffId?: string;
};

type TemplateOptions = {
  startsOn?: string;
  db?: typeof prisma;
};

type ExportOptions = {
  rotaPeriodId: string;
  db?: typeof prisma;
};

type ImportChangeType = "CREATE" | "UPDATE" | "CLEAR" | "UNCHANGED";

type ImportChangePreview = {
  staffId: string;
  staffName: string;
  date: string;
  action: ImportChangeType;
  previousValue: string;
  nextValue: string;
};

type ExistingAssignmentSnapshot = {
  id: string;
  staffId: string;
  date: string;
  shiftType: RotaShiftType;
  note: string | null;
};

export type RotaSpreadsheetImportPreview = {
  previewKey: string;
  fileName: string;
  detectedDelimiter: "," | "\t" | ";";
  period: {
    startsOn: string;
    endsOn: string;
    rotaPeriodId: string | null;
    label: string | null;
    exists: boolean;
  };
  summary: {
    weekBlocks: number;
    parsedAssignments: number;
    parsedOffDays: number;
    skippedCells: number;
    warningCount: number;
    blockingIssueCount: number;
    matchedStaffCount: number;
    createCount: number;
    updateCount: number;
    clearCount: number;
    unchangedCount: number;
  };
  warnings: string[];
  blockingIssues: string[];
  canConfirm: boolean;
  changes: ImportChangePreview[];
};

export type RotaSpreadsheetImportResult = RotaSpreadsheetImportPreview & {
  importBatchKey: string;
  createdAssignments: number;
  updatedAssignments: number;
  clearedAssignments: number;
  unchangedAssignments: number;
  createdByStaffId: string | null;
  rotaPeriod: {
    id: string;
    label: string;
    startsOn: string;
    endsOn: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  };
};

export type RotaSpreadsheetDownload = {
  fileName: string;
  content: string;
};

const ROUND_TRIP_SHIFT_LABELS: Record<RotaShiftType, string> = {
  FULL_DAY: "Full",
  HALF_DAY_AM: "AM",
  HALF_DAY_PM: "PM",
  HOLIDAY: "Holiday",
};

const MONDAY_TO_SATURDAY: StoreWeekdayKey[] = STORE_WEEKDAY_KEYS.slice(0, 6);
const MAX_PREVIEW_CHANGES = 24;

const normalizeSpreadsheetText = (value: string) =>
  value.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const normalizeCell = (value: string) => value.replace(/\s+/g, " ").trim();

const normalizeStaffKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const parseDelimiter = (value: string | undefined): LegacyRotaImportDelimiter => {
  if (value === "," || value === "\t" || value === ";" || value === "auto") {
    return value;
  }
  return "auto";
};

const ensureSpreadsheetText = (value: string | undefined) => {
  const normalized = typeof value === "string" ? normalizeSpreadsheetText(value) : "";
  if (!normalized.trim()) {
    throw new HttpError(400, "spreadsheetText is required", "INVALID_ROTA_IMPORT");
  }
  return normalized;
};

const normalizeFileName = (value: string | undefined, fallback = "rota-import.csv") => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || fallback;
};

const detectDelimiter = (content: string, preferred: LegacyRotaImportDelimiter) => {
  if (preferred !== "auto") {
    return preferred;
  }

  const firstLine = content.split("\n", 1)[0] ?? "";
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const semicolonCount = (firstLine.match(/;/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;

  if (tabCount >= semicolonCount && tabCount >= commaCount && tabCount > 0) {
    return "\t";
  }
  if (semicolonCount > commaCount) {
    return ";";
  }
  return ",";
};

const parseDelimitedText = (content: string, delimiter: "," | "\t" | ";") => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell.trim());
    cell = "";
  };

  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      pushCell();
      continue;
    }

    if (!inQuotes && char === "\n") {
      pushRow();
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
};

const weekdayAliases: Record<StoreWeekdayKey, string[]> = {
  MONDAY: ["monday", "mon"],
  TUESDAY: ["tuesday", "tue", "tues"],
  WEDNESDAY: ["wednesday", "wed"],
  THURSDAY: ["thursday", "thu", "thur", "thurs"],
  FRIDAY: ["friday", "fri"],
  SATURDAY: ["saturday", "sat"],
  SUNDAY: ["sunday", "sun"],
};

const monthNames = new Map<string, number>([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

const toIsoDate = (year: number, month: number, day: number) => {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(value.getTime())
    || value.getUTCFullYear() !== year
    || value.getUTCMonth() !== month - 1
    || value.getUTCDate() !== day
  ) {
    return null;
  }
  return value.toISOString().slice(0, 10);
};

const parseFlexibleDate = (rawValue: string, fallbackYear?: number) => {
  const raw = normalizeCell(rawValue)
    .replace(/,/g, " ")
    .replace(/\b(mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) {
    return null;
  }

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (isoMatch) {
    return toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const numericMatch = /^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/.exec(raw);
  if (numericMatch) {
    const day = Number(numericMatch[1]);
    const month = Number(numericMatch[2]);
    const year = numericMatch[3]
      ? Number(numericMatch[3].length === 2 ? `20${numericMatch[3]}` : numericMatch[3])
      : fallbackYear;
    if (year) {
      return toIsoDate(year, month, day);
    }
  }

  const monthNameMatch = /^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{2,4}))?$/.exec(raw);
  if (monthNameMatch) {
    const day = Number(monthNameMatch[1]);
    const month = monthNames.get(monthNameMatch[2].toLowerCase());
    const year = monthNameMatch[3]
      ? Number(monthNameMatch[3].length === 2 ? `20${monthNameMatch[3]}` : monthNameMatch[3])
      : fallbackYear;
    if (month && year) {
      return toIsoDate(year, month, day);
    }
  }

  return null;
};

const parseWeekStartLabel = (row: string[]) => {
  const joinedRow = row.map(normalizeCell).filter(Boolean).join(" ");
  if (joinedRow) {
    const joinedMatch = /(?:week commencing|w\/c|week of)\s*:?\s*(.+)$/i.exec(joinedRow);
    if (joinedMatch) {
      const parsed = parseFlexibleDate(joinedMatch[1]);
      if (parsed) {
        return parsed;
      }
    }
  }

  for (const rawCell of row) {
    const cell = normalizeCell(rawCell);
    if (!cell) {
      continue;
    }

    const match = /(?:week commencing|w\/c|week of)\s*:?\s*(.+)$/i.exec(cell);
    if (!match) {
      continue;
    }

    const parsed = parseFlexibleDate(match[1]);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const rowHasAnyValue = (row: string[]) => row.some((cell) => normalizeCell(cell).length > 0);

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const weekdayForIndex = (index: number) => STORE_WEEKDAY_KEYS[index] ?? "MONDAY";

const cellMatchesWeekday = (value: string, weekday: StoreWeekdayKey, expectedDate: string) => {
  const normalized = normalizeCell(value).toLowerCase();
  if (!normalized) {
    return false;
  }

  const containsWeekday = weekdayAliases[weekday].some((alias) => normalized.includes(alias));
  const parsedDate = parseFlexibleDate(value, Number(expectedDate.slice(0, 4)));

  if (parsedDate) {
    return parsedDate === expectedDate;
  }

  return containsWeekday;
};

const detectWeekBlock = (rows: string[][], rowIndex: number, weekStart: string | null): SpreadsheetBlock | null => {
  const fallbackYear = weekStart ? Number(weekStart.slice(0, 4)) : undefined;
  const row = rows[rowIndex];

  for (let startCol = 0; startCol <= Math.max(0, row.length - 6); startCol += 1) {
    const candidateDates: Partial<Record<StoreWeekdayKey, string>> = {};
    let valid = true;

    for (let offset = 0; offset < 6; offset += 1) {
      const weekday = weekdayForIndex(offset);
      const expectedDate = weekStart ? addDays(weekStart, offset) : null;
      const headerCell = row[startCol + offset] ?? "";
      const parsedDate = parseFlexibleDate(headerCell, fallbackYear);

      if (expectedDate) {
        if (!cellMatchesWeekday(headerCell, weekday, expectedDate)) {
          valid = false;
          break;
        }
        candidateDates[weekday] = expectedDate;
        continue;
      }

      if (!parsedDate) {
        valid = false;
        break;
      }

      const parsedWeekday = new Date(`${parsedDate}T00:00:00.000Z`).getUTCDay();
      const expectedWeekday = offset === 5 ? 6 : offset + 1;
      if (parsedWeekday !== expectedWeekday) {
        valid = false;
        break;
      }
      candidateDates[weekday] = parsedDate;
    }

    if (!valid) {
      continue;
    }

    return {
      blockStartRowIndex: rowIndex,
      headerRowIndex: rowIndex,
      startCol,
      dates: {
        MONDAY: candidateDates.MONDAY!,
        TUESDAY: candidateDates.TUESDAY!,
        WEDNESDAY: candidateDates.WEDNESDAY!,
        THURSDAY: candidateDates.THURSDAY!,
        FRIDAY: candidateDates.FRIDAY!,
        SATURDAY: candidateDates.SATURDAY!,
        SUNDAY: weekStart ? addDays(weekStart, 6) : addDays(candidateDates.MONDAY!, 6),
      },
    };
  }

  return null;
};

const detectSpreadsheetBlocks = (rows: string[][]) => {
  const blocks: SpreadsheetBlock[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const weekStart = parseWeekStartLabel(rows[rowIndex]);
    if (weekStart) {
      for (let cursor = rowIndex + 1; cursor < rows.length; cursor += 1) {
        if (!rowHasAnyValue(rows[cursor])) {
          continue;
        }
        const block = detectWeekBlock(rows, cursor, weekStart);
        if (block) {
          block.blockStartRowIndex = rowIndex;
          blocks.push(block);
        }
        break;
      }
      continue;
    }

    const block = detectWeekBlock(rows, rowIndex, null);
    if (block) {
      blocks.push(block);
    }
  }

  const deduped = new Map<string, SpreadsheetBlock>();
  for (const block of blocks) {
    deduped.set(`${block.headerRowIndex}:${block.startCol}:${block.dates.MONDAY}`, block);
  }

  return [...deduped.values()].sort((left, right) => left.headerRowIndex - right.headerRowIndex);
};

const parseLegacyTimeRange = (rawValue: string) => {
  const normalized = normalizeCell(rawValue).replace(/\./g, ":");
  const match = /^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/.exec(normalized);
  if (!match) {
    return null;
  }

  let startHour = Number(match[1]);
  let endHour = Number(match[3]);
  const startMinutes = Number(match[2] ?? "0");
  const endMinutes = Number(match[4] ?? "0");

  if (endHour < startHour && endHour < 12) {
    endHour += 12;
  }

  if (startHour > 23 || endHour > 23 || startMinutes > 59 || endMinutes > 59) {
    return null;
  }

  return {
    opensAt: `${`${startHour}`.padStart(2, "0")}:${`${startMinutes}`.padStart(2, "0")}`,
    closesAt: `${`${endHour}`.padStart(2, "0")}:${`${endMinutes}`.padStart(2, "0")}`,
  };
};

type InterpretedImportCell =
  | { kind: "skip" }
  | { kind: "clear" }
  | { kind: "set"; shiftType: RotaShiftType; note: string | null }
  | { kind: "issue"; message: string };

const interpretCellValue = (
  rawValue: string,
  weekday: StoreWeekdayKey,
  openingHours: StoreOpeningHoursSettings,
): InterpretedImportCell => {
  const normalized = normalizeCell(rawValue);
  if (!normalized || normalized.toLowerCase() === "x") {
    return { kind: "skip" };
  }

  if (/^off$/i.test(normalized)) {
    return { kind: "clear" };
  }

  if (/^(holiday|annual leave)$/i.test(normalized)) {
    return {
      kind: "set",
      shiftType: "HOLIDAY",
      note: normalized,
    };
  }

  if (/^full$/i.test(normalized)) {
    return {
      kind: "set",
      shiftType: "FULL_DAY",
      note: null,
    };
  }

  if (/^am$/i.test(normalized)) {
    return {
      kind: "set",
      shiftType: "HALF_DAY_AM",
      note: null,
    };
  }

  if (/^pm$/i.test(normalized)) {
    return {
      kind: "set",
      shiftType: "HALF_DAY_PM",
      note: null,
    };
  }

  if (/^training day$/i.test(normalized)) {
    return {
      kind: "set",
      shiftType: "FULL_DAY",
      note: "Training day",
    };
  }

  const timeRange = parseLegacyTimeRange(normalized);
  if (!timeRange) {
    return {
      kind: "issue",
      message: `Unexpected rota value "${normalized}" for ${STORE_WEEKDAY_LABELS[weekday]}. Use Full, AM, PM, Off, Holiday, or the legacy full-day time range.`,
    };
  }

  const dayHours = openingHours[weekday];
  if (dayHours.isClosed) {
    return {
      kind: "issue",
      message: `Found "${normalized}" on ${STORE_WEEKDAY_LABELS[weekday]}, but Store Info marks that day as closed.`,
    };
  }

  const importedOpens = clockTimeToMinutes(timeRange.opensAt);
  const importedCloses = clockTimeToMinutes(timeRange.closesAt);
  const expectedOpens = clockTimeToMinutes(dayHours.opensAt);
  const expectedCloses = clockTimeToMinutes(dayHours.closesAt);

  if (
    importedOpens !== null
    && importedCloses !== null
    && expectedOpens !== null
    && expectedCloses !== null
    && importedOpens === expectedOpens
    && importedCloses === expectedCloses
  ) {
    return {
      kind: "set",
      shiftType: "FULL_DAY",
      note: null,
    };
  }

  return {
    kind: "issue",
    message: `Unexpected rota time "${normalized}" for ${STORE_WEEKDAY_LABELS[weekday]}; expected ${dayHours.opensAt}-${dayHours.closesAt} for FULL_DAY.`,
  };
};

const buildStaffLookup = (staff: StaffRecord[]) => {
  const lookup = new Map<string, StaffRecord[]>();

  for (const member of staff) {
    const keys = new Set<string>();
    if (member.name) {
      const normalizedName = normalizeStaffKey(member.name);
      if (normalizedName) {
        keys.add(normalizedName);
      }
    }

    const normalizedUsername = normalizeStaffKey(member.username);
    if (normalizedUsername) {
      keys.add(normalizedUsername);
    }

    for (const key of keys) {
      const bucket = lookup.get(key) ?? [];
      bucket.push(member);
      lookup.set(key, bucket);
    }
  }

  return lookup;
};

const findMatchingStaff = (
  rawName: string,
  lookup: Map<string, StaffRecord[]>,
): { staff: StaffRecord | null; warning: string | null } => {
  const normalizedName = normalizeStaffKey(rawName);
  if (!normalizedName) {
    return {
      staff: null,
      warning: null,
    };
  }

  const matches = lookup.get(normalizedName) ?? [];
  if (matches.length === 1) {
    const [staff] = matches;
    if (!staff.isActive) {
      return {
        staff,
        warning: `Matched inactive staff record "${rawName}" to ${staff.name?.trim() || staff.username}.`,
      };
    }
    return { staff, warning: null };
  }

  if (matches.length > 1) {
    return {
      staff: null,
      warning: `Ambiguous staff match for "${rawName}" (${matches.map((match) => match.name?.trim() || match.username).join(", ")}).`,
    };
  }

  return {
    staff: null,
    warning: `No CorePOS staff match found for "${rawName}".`,
  };
};

const parseAssignmentsFromRows = (
  rows: string[][],
  blocks: SpreadsheetBlock[],
  openingHours: StoreOpeningHoursSettings,
  staffLookup: Map<string, StaffRecord[]>,
): ParsedAssignmentsResult => {
  const cells: ParsedImportCell[] = [];
  const warnings: string[] = [];
  const blockingIssues: string[] = [];
  const matchedStaffIds = new Set<string>();
  let skippedCells = 0;

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    const nextBlockRowIndex = blocks[blockIndex + 1]?.blockStartRowIndex ?? rows.length;

    for (let rowIndex = block.headerRowIndex + 1; rowIndex < nextBlockRowIndex; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!rowHasAnyValue(row)) {
        continue;
      }

      const nameCells = row.slice(0, block.startCol).map(normalizeCell).filter(Boolean);
      const staffName = nameCells[nameCells.length - 1] ?? "";
      if (!staffName || /^(name|staff|employee)$/i.test(staffName)) {
        continue;
      }
      if (/^(closed day|closed|store closed)$/i.test(staffName)) {
        continue;
      }

      const staffMatch = findMatchingStaff(staffName, staffLookup);
      if (staffMatch.warning) {
        if (staffMatch.staff) {
          warnings.push(`Row ${rowIndex + 1}: ${staffMatch.warning}`);
        } else {
          blockingIssues.push(`Row ${rowIndex + 1}: ${staffMatch.warning}`);
        }
      }
      if (!staffMatch.staff) {
        skippedCells += 6;
        continue;
      }

      matchedStaffIds.add(staffMatch.staff.id);

      for (let offset = 0; offset < 6; offset += 1) {
        const weekday = weekdayForIndex(offset);
        const date = block.dates[weekday];
        const rawValue = row[block.startCol + offset] ?? "";
        const interpreted = interpretCellValue(rawValue, weekday, openingHours);

        if (interpreted.kind === "skip") {
          skippedCells += 1;
          continue;
        }

        if (interpreted.kind === "issue") {
          blockingIssues.push(`Row ${rowIndex + 1} ${STORE_WEEKDAY_LABELS[weekday]} ${date}: ${interpreted.message}`);
          skippedCells += 1;
          continue;
        }

        cells.push({
          staffId: staffMatch.staff.id,
          staffName: staffMatch.staff.name?.trim() || staffMatch.staff.username,
          date,
          shiftType: interpreted.kind === "clear" ? null : interpreted.shiftType,
          note: interpreted.kind === "clear" ? null : interpreted.note,
          rawValue: normalizeCell(rawValue),
          rowNumber: rowIndex + 1,
        });
      }
    }
  }

  const dedupedCells: ParsedImportCell[] = [];
  const seenKeys = new Map<string, ParsedImportCell>();
  for (const cell of cells) {
    const key = `${cell.staffId}:${cell.date}`;
    const existing = seenKeys.get(key);
    if (existing) {
      blockingIssues.push(
        `Duplicate spreadsheet entry for ${cell.staffName} on ${cell.date} (rows ${existing.rowNumber} and ${cell.rowNumber}). Keep one row per staff member per week.`,
      );
      skippedCells += 1;
      continue;
    }
    seenKeys.set(key, cell);
    dedupedCells.push(cell);
  }

  return {
    cells: dedupedCells,
    warnings,
    blockingIssues,
    skippedCells,
    matchedStaffIds: [...matchedStaffIds],
  };
};

const buildPreviewKey = (fileName: string, delimiter: string, spreadsheetText: string) =>
  createHash("sha256")
    .update(fileName, "utf8")
    .update("\n", "utf8")
    .update(delimiter, "utf8")
    .update("\n", "utf8")
    .update(spreadsheetText, "utf8")
    .digest("hex");

const buildImportBatchKey = (fileName: string, timeZone: string) =>
  `${path.basename(fileName)}:${formatDateKeyInTimeZone(new Date(), timeZone)}`;

const filterAssignmentsAgainstClosedDays = async (
  cells: ParsedImportCell[],
  db: typeof prisma,
): Promise<ParsedAssignmentsResult> => {
  const uniqueDates = [...new Set(cells.map((cell) => cell.date))];
  const schedules = new Map<string, Awaited<ReturnType<typeof resolveStoreDaySchedule>>>();

  for (const date of uniqueDates) {
    schedules.set(
      date,
      await resolveStoreDaySchedule(new Date(`${date}T12:00:00.000Z`), db),
    );
  }

  const filteredCells: ParsedImportCell[] = [];
  const warnings: string[] = [];
  const blockingIssues: string[] = [];
  let skippedCells = 0;

  for (const cell of cells) {
    const schedule = schedules.get(cell.date);
    if (schedule?.isClosed) {
      if (cell.shiftType === null) {
        warnings.push(
          `Ignoring Off for ${cell.staffName} on ${cell.date} because the store is closed${schedule.closedReason ? ` (${schedule.closedReason})` : ""}.`,
        );
      } else {
        blockingIssues.push(
          `Cannot schedule ${cell.staffName} on ${cell.date} because the store is closed${schedule.closedReason ? ` (${schedule.closedReason})` : ""}.`,
        );
      }
      skippedCells += 1;
      continue;
    }

    filteredCells.push(cell);
  }

  return {
    cells: filteredCells,
    warnings,
    blockingIssues,
    skippedCells,
    matchedStaffIds: [...new Set(filteredCells.map((cell) => cell.staffId))],
  };
};

const shiftTypeToImportLabel = (shiftType: RotaShiftType | null, note: string | null = null) => {
  if (!shiftType) {
    return "Off";
  }
  if (shiftType === "FULL_DAY" && note?.trim() === "Training day") {
    return "Full";
  }
  return ROUND_TRIP_SHIFT_LABELS[shiftType];
};

const loadExistingAssignmentsForCells = async (
  cells: ParsedImportCell[],
  db: typeof prisma,
) => {
  if (!cells.length) {
    return new Map<string, ExistingAssignmentSnapshot>();
  }

  const staffIds = [...new Set(cells.map((cell) => cell.staffId))];
  const dates = [...new Set(cells.map((cell) => cell.date))];
  const existingAssignments = await db.rotaAssignment.findMany({
    where: {
      staffId: {
        in: staffIds,
      },
      date: {
        in: dates,
      },
    },
    select: {
      id: true,
      staffId: true,
      date: true,
      shiftType: true,
      note: true,
    },
  });

  return new Map(existingAssignments.map((assignment) => [`${assignment.staffId}:${assignment.date}`, assignment]));
};

const compareImportCells = (
  cells: ParsedImportCell[],
  existingAssignments: Map<string, ExistingAssignmentSnapshot>,
) => {
  const changes: ImportChangePreview[] = [];
  let createCount = 0;
  let updateCount = 0;
  let clearCount = 0;
  let unchangedCount = 0;

  for (const cell of cells) {
    const existing = existingAssignments.get(`${cell.staffId}:${cell.date}`) ?? null;
    const previousValue = existing ? shiftTypeToImportLabel(existing.shiftType, existing.note) : "Off";
    const nextValue = shiftTypeToImportLabel(cell.shiftType, cell.note);

    let action: ImportChangeType = "UNCHANGED";
    if (cell.shiftType === null) {
      action = existing ? "CLEAR" : "UNCHANGED";
    } else if (!existing) {
      action = "CREATE";
    } else if (
      existing.shiftType === cell.shiftType
      && (
        !normalizeCell(cell.note ?? "")
        || normalizeCell(existing.note ?? "") === normalizeCell(cell.note ?? "")
      )
    ) {
      action = "UNCHANGED";
    } else {
      action = "UPDATE";
    }

    if (action === "CREATE") {
      createCount += 1;
    } else if (action === "UPDATE") {
      updateCount += 1;
    } else if (action === "CLEAR") {
      clearCount += 1;
    } else {
      unchangedCount += 1;
    }

    if (changes.length < MAX_PREVIEW_CHANGES) {
      changes.push({
        staffId: cell.staffId,
        staffName: cell.staffName,
        date: cell.date,
        action,
        previousValue,
        nextValue,
      });
    }
  }

  return {
    changes,
    createCount,
    updateCount,
    clearCount,
    unchangedCount,
  };
};

const escapeCsvCell = (value: string) => {
  if (value.includes(",") || value.includes("\"") || value.includes("\n") || value.includes("\r")) {
    return `"${value.replaceAll("\"", "\"\"")}"`;
  }
  return value;
};

const rowsToCsv = (rows: string[][]) => rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(",")).join("\n");

const formatSpreadsheetDate = (date: string) => {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
};

const formatTimestampForCsv = (value: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);

const formatSpreadsheetWeekdayHeader = (weekday: StoreWeekdayKey, date: string) =>
  `${STORE_WEEKDAY_LABELS[weekday].slice(0, 3)} ${formatSpreadsheetDate(date).slice(0, 5)}`;

const resolveTemplateStartsOn = (startsOn?: string) => {
  if (startsOn) {
    return normalizeDateKeyOrThrow(startsOn, "INVALID_ROTA_TEMPLATE_DATE");
  }

  const now = new Date();
  const utcDay = now.getUTCDay();
  const mondayOffset = utcDay === 0 ? -6 : 1 - utcDay;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() + mondayOffset);
  return monday.toISOString().slice(0, 10);
};

const buildSpreadsheetRows = async (
  startsOn: string,
  staffRows: Array<{ name: string; values: Record<string, string> }>,
  db: typeof prisma,
  title: string,
) => {
  const rows: string[][] = [
    [title],
    ["Supported shifts", "Full", "AM", "PM", "Off", "Holiday"],
    ["Notes", "Monday-Saturday only", "Use Off to clear a shift on re-import", "Closed days are shown below when relevant"],
    [],
  ];

  for (let weekIndex = 0; weekIndex < 6; weekIndex += 1) {
    const weekStartsOn = addDays(startsOn, weekIndex * 7);
    const weekDates = MONDAY_TO_SATURDAY.map((weekday, offset) => ({
      weekday,
      date: addDays(weekStartsOn, offset),
    }));

    rows.push(["Week commencing", formatSpreadsheetDate(weekStartsOn)]);
    rows.push(["Name", ...weekDates.map(({ weekday, date }) => formatSpreadsheetWeekdayHeader(weekday, date))]);

    const closedLabels = await Promise.all(
      weekDates.map(async ({ date }) => {
        const schedule = await resolveStoreDaySchedule(new Date(`${date}T12:00:00.000Z`), db);
        if (!schedule.isClosed) {
          return "";
        }
        return schedule.closedReason?.trim() ? `Closed: ${schedule.closedReason.trim()}` : "Closed";
      }),
    );

    if (closedLabels.some(Boolean)) {
      rows.push(["Closed day", ...closedLabels]);
    }

    for (const staffRow of staffRows) {
      rows.push([
        staffRow.name,
        ...weekDates.map(({ date }) => staffRow.values[date] ?? "Off"),
      ]);
    }

    if (weekIndex < 5) {
      rows.push([]);
    }
  }

  return rows;
};

const resolvePeriodForWindow = async (
  startsOn: string,
  endsOn: string,
  db: typeof prisma,
) => db.rotaPeriod.findFirst({
  where: {
    startsOn,
    endsOn,
  },
  select: {
    id: true,
    label: true,
    startsOn: true,
    endsOn: true,
    status: true,
  },
});

const previewParsedSpreadsheet = async (
  input: PreviewOptions,
): Promise<RotaSpreadsheetImportPreview> => {
  const db = input.db ?? prisma;
  const spreadsheetText = ensureSpreadsheetText(input.spreadsheetText);
  const fileName = normalizeFileName(input.fileName);
  const delimiter = detectDelimiter(spreadsheetText, parseDelimiter(input.delimiter));
  const rows = parseDelimitedText(spreadsheetText, delimiter);
  const blocks = detectSpreadsheetBlocks(rows);

  if (!blocks.length) {
    throw new HttpError(
      400,
      "Could not detect any weekly rota blocks in the spreadsheet export.",
      "INVALID_ROTA_IMPORT",
    );
  }

  const [staff, settings] = await Promise.all([
    db.user.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        isActive: true,
      },
    }),
    listShopSettings(db),
  ]);

  const staffLookup = buildStaffLookup(staff);
  const parsed = parseAssignmentsFromRows(rows, blocks, settings.store.openingHours, staffLookup);
  const closedDayFiltered = await filterAssignmentsAgainstClosedDays(parsed.cells, db);
  const warnings = [...parsed.warnings, ...closedDayFiltered.warnings];
  const blockingIssues = [...parsed.blockingIssues, ...closedDayFiltered.blockingIssues];
  const actionableCells = closedDayFiltered.cells;
  const skippedCells = parsed.skippedCells + closedDayFiltered.skippedCells;

  if (!actionableCells.length) {
    throw new HttpError(
      400,
      "No actionable rota changes were parsed from the spreadsheet export.",
      "INVALID_ROTA_IMPORT",
    );
  }

  const importedDates = [...new Set(actionableCells.map((cell) => cell.date))].sort();
  const earliestDate = importedDates[0];
  const latestDate = importedDates[importedDates.length - 1];
  const rotaWindow = buildSixWeekRotaWindow(earliestDate);
  if (latestDate > rotaWindow.endsOn) {
    throw new HttpError(
      400,
      `Import spans beyond a single 6-week rota period (${rotaWindow.startsOn}..${rotaWindow.endsOn}).`,
      "INVALID_ROTA_IMPORT",
    );
  }

  const [existingAssignments, existingPeriod] = await Promise.all([
    loadExistingAssignmentsForCells(actionableCells, db),
    resolvePeriodForWindow(rotaWindow.startsOn, rotaWindow.endsOn, db),
  ]);
  const comparison = compareImportCells(actionableCells, existingAssignments);

  return {
    previewKey: buildPreviewKey(fileName, delimiter, spreadsheetText),
    fileName,
    detectedDelimiter: delimiter,
    period: {
      startsOn: rotaWindow.startsOn,
      endsOn: rotaWindow.endsOn,
      rotaPeriodId: existingPeriod?.id ?? null,
      label: existingPeriod?.label ?? null,
      exists: Boolean(existingPeriod),
    },
    summary: {
      weekBlocks: blocks.length,
      parsedAssignments: actionableCells.filter((cell) => cell.shiftType !== null).length,
      parsedOffDays: actionableCells.filter((cell) => cell.shiftType === null).length,
      skippedCells,
      warningCount: warnings.length,
      blockingIssueCount: blockingIssues.length,
      matchedStaffCount: new Set(actionableCells.map((cell) => cell.staffId)).size,
      createCount: comparison.createCount,
      updateCount: comparison.updateCount,
      clearCount: comparison.clearCount,
      unchangedCount: comparison.unchangedCount,
    },
    warnings,
    blockingIssues,
    canConfirm: blockingIssues.length === 0,
    changes: comparison.changes,
  };
};

export const previewRotaSpreadsheetImport = async (
  input: PreviewOptions,
): Promise<RotaSpreadsheetImportPreview> => previewParsedSpreadsheet(input);

export const confirmRotaSpreadsheetImport = async (
  input: ConfirmOptions,
): Promise<RotaSpreadsheetImportResult> => {
  const db = input.db ?? prisma;
  const preview = await previewParsedSpreadsheet(input);
  const spreadsheetText = ensureSpreadsheetText(input.spreadsheetText);
  const fileName = normalizeFileName(input.fileName);
  const previewKey = typeof input.previewKey === "string" ? input.previewKey.trim() : "";

  if (!previewKey) {
    throw new HttpError(400, "previewKey is required", "INVALID_ROTA_IMPORT_CONFIRM");
  }
  if (preview.previewKey !== previewKey) {
    throw new HttpError(
      409,
      "Preview is stale. Run preview again before importing.",
      "STALE_ROTA_IMPORT_PREVIEW",
    );
  }
  if (!preview.canConfirm) {
    throw new HttpError(
      400,
      `Fix the spreadsheet issues before importing: ${preview.blockingIssues.join(" ")}`,
      "INVALID_ROTA_IMPORT",
    );
  }

  const delimiter = detectDelimiter(spreadsheetText, parseDelimiter(input.delimiter));
  const rows = parseDelimitedText(spreadsheetText, delimiter);
  const blocks = detectSpreadsheetBlocks(rows);
  const [staff, settings] = await Promise.all([
    db.user.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        isActive: true,
      },
    }),
    listShopSettings(db),
  ]);

  const staffLookup = buildStaffLookup(staff);
  const parsed = parseAssignmentsFromRows(rows, blocks, settings.store.openingHours, staffLookup);
  const filteredAssignments = await filterAssignmentsAgainstClosedDays(parsed.cells, db);
  const actionableCells = filteredAssignments.cells;
  const earliestDate = [...new Set(actionableCells.map((cell) => cell.date))].sort()[0];
  const importBatchKey = buildImportBatchKey(fileName, settings.store.timeZone);

  let createdAssignments = 0;
  let updatedAssignments = 0;
  let clearedAssignments = 0;
  let unchangedAssignments = 0;

  const rotaPeriod = await db.$transaction(async (tx) => {
    const selectedPeriod = await getOrCreateSixWeekRotaPeriod(earliestDate, tx);
    const existingAssignments = await loadExistingAssignmentsForCells(actionableCells, tx as typeof prisma);
    const comparison = compareImportCells(actionableCells, existingAssignments);

    for (const cell of actionableCells) {
      const existing = existingAssignments.get(`${cell.staffId}:${cell.date}`) ?? null;
      const matchedChange = comparison.changes.find(
        (change) => change.staffId === cell.staffId && change.date === cell.date,
      );
      const action = matchedChange?.action
        ?? (cell.shiftType === null ? (existing ? "CLEAR" : "UNCHANGED") : existing ? "UPDATE" : "CREATE");

      if (action === "UNCHANGED") {
        unchangedAssignments += 1;
        continue;
      }

      if (action === "CLEAR") {
        if (existing) {
          await tx.rotaAssignment.delete({
            where: {
              id: existing.id,
            },
          });
          clearedAssignments += 1;
        } else {
          unchangedAssignments += 1;
        }
        continue;
      }

      if (cell.shiftType === null) {
        unchangedAssignments += 1;
        continue;
      }

      await tx.rotaAssignment.upsert({
        where: {
          staffId_date: {
            staffId: cell.staffId,
            date: cell.date,
          },
        },
        create: {
          rotaPeriodId: selectedPeriod.id,
          staffId: cell.staffId,
          date: cell.date,
          shiftType: cell.shiftType,
          source: RotaAssignmentSource.IMPORT,
          note: cell.note,
          rawValue: cell.rawValue,
          importBatchKey,
        },
        update: {
          rotaPeriodId: selectedPeriod.id,
          shiftType: cell.shiftType,
          source: RotaAssignmentSource.IMPORT,
          note: cell.note ?? existing?.note ?? null,
          rawValue: cell.rawValue,
          importBatchKey,
        },
      });

      if (action === "CREATE") {
        createdAssignments += 1;
      } else {
        updatedAssignments += 1;
      }
    }

    return selectedPeriod;
  });

  return {
    ...preview,
    importBatchKey,
    createdAssignments,
    updatedAssignments,
    clearedAssignments,
    unchangedAssignments,
    createdByStaffId: input.createdByStaffId?.trim() || null,
    rotaPeriod: {
      id: rotaPeriod.id,
      label: rotaPeriod.label,
      startsOn: rotaPeriod.startsOn,
      endsOn: rotaPeriod.endsOn,
      status: rotaPeriod.status,
    },
  };
};

export const downloadRotaTemplate = async (
  input: TemplateOptions = {},
): Promise<RotaSpreadsheetDownload> => {
  const db = input.db ?? prisma;
  const startsOn = resolveTemplateStartsOn(input.startsOn);
  const rotaWindow = buildSixWeekRotaWindow(startsOn);
  const staff = await db.user.findMany({
    where: {
      isActive: true,
    },
    select: {
      id: true,
      username: true,
      name: true,
    },
    orderBy: [
      { name: "asc" },
      { username: "asc" },
    ],
  });

  const rows = await buildSpreadsheetRows(
    rotaWindow.startsOn,
    staff.map((member) => ({
      name: member.name?.trim() || member.username,
      values: {},
    })),
    db,
    `CorePOS rota template · ${rotaWindow.startsOn} to ${rotaWindow.endsOn}`,
  );

  return {
    fileName: `corepos-rota-template-${rotaWindow.startsOn}.csv`,
    content: `${rowsToCsv(rows)}\n`,
  };
};

export const exportRotaPeriodSpreadsheet = async (
  input: ExportOptions,
): Promise<RotaSpreadsheetDownload> => {
  const db = input.db ?? prisma;
  const rotaPeriodId = typeof input.rotaPeriodId === "string" ? input.rotaPeriodId.trim() : "";
  if (!rotaPeriodId) {
    throw new HttpError(400, "rotaPeriodId is required", "INVALID_ROTA_EXPORT");
  }

  const rotaPeriod = await db.rotaPeriod.findUnique({
    where: {
      id: rotaPeriodId,
    },
    select: {
      id: true,
      label: true,
      startsOn: true,
      endsOn: true,
      createdAt: true,
    },
  });

  if (!rotaPeriod) {
    throw new HttpError(404, "Rota period not found", "ROTA_PERIOD_NOT_FOUND");
  }

  const [assignments, settings] = await Promise.all([
    db.rotaAssignment.findMany({
      where: {
        rotaPeriodId: rotaPeriod.id,
      },
      select: {
        staffId: true,
        date: true,
        shiftType: true,
        note: true,
      },
    }),
    listShopSettings(db),
  ]);

  const assignedStaffIds = [...new Set(assignments.map((assignment) => assignment.staffId))];
  const staff = await db.user.findMany({
    where: assignedStaffIds.length
      ? {
        id: {
          in: assignedStaffIds,
        },
      }
      : {
        isActive: true,
      },
    select: {
      id: true,
      username: true,
      name: true,
    },
    orderBy: [
      { name: "asc" },
      { username: "asc" },
    ],
  });

  const assignmentMap = new Map<string, { shiftType: RotaShiftType; note: string | null }>();
  for (const assignment of assignments) {
    assignmentMap.set(`${assignment.staffId}:${assignment.date}`, {
      shiftType: assignment.shiftType,
      note: assignment.note,
    });
  }

  const rows = await buildSpreadsheetRows(
    rotaPeriod.startsOn,
    staff.map((member) => {
      const values: Record<string, string> = {};
      for (let offset = 0; offset < 42; offset += 1) {
        const date = addDays(rotaPeriod.startsOn, offset);
        const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
        if (weekday === 0) {
          continue;
        }
        const assignment = assignmentMap.get(`${member.id}:${date}`);
        values[date] = assignment ? shiftTypeToImportLabel(assignment.shiftType, assignment.note) : "Off";
      }

      return {
        name: member.name?.trim() || member.username,
        values,
      };
    }),
    db,
    `CorePOS rota export · ${rotaPeriod.label} · generated ${formatTimestampForCsv(rotaPeriod.createdAt, settings.store.timeZone)}`,
  );

  return {
    fileName: `corepos-rota-${rotaPeriod.startsOn}.csv`,
    content: `${rowsToCsv(rows)}\n`,
  };
};
