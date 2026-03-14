import { createHash } from "node:crypto";
import path from "node:path";
import { RotaAssignmentSource, RotaShiftType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { listShopSettings } from "./configurationService";
import { buildSixWeekRotaWindow, getOrCreateSixWeekRotaPeriod } from "./rotaService";
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

type ParsedImportAssignment = {
  staffId: string;
  staffName: string;
  date: string;
  shiftType: RotaShiftType;
  note: string | null;
  rawValue: string;
};

type ParsedAssignmentsResult = {
  assignments: ParsedImportAssignment[];
  warnings: string[];
  skippedCells: number;
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

export type RotaSpreadsheetImportPreview = {
  previewKey: string;
  fileName: string;
  detectedDelimiter: "," | "\t" | ";";
  period: {
    startsOn: string;
    endsOn: string;
  };
  summary: {
    weekBlocks: number;
    parsedAssignments: number;
    skippedCells: number;
    warningCount: number;
    matchedStaffCount: number;
  };
  warnings: string[];
};

export type RotaSpreadsheetImportResult = RotaSpreadsheetImportPreview & {
  importBatchKey: string;
  createdAssignments: number;
  updatedAssignments: number;
  createdByStaffId: string | null;
  rotaPeriod: {
    id: string;
    label: string;
    startsOn: string;
    endsOn: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  };
};

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

const normalizeFileName = (value: string | undefined) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || "rota-import.csv";
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

const interpretCellValue = (
  rawValue: string,
  weekday: StoreWeekdayKey,
  openingHours: StoreOpeningHoursSettings,
): { shiftType: RotaShiftType; note: string | null } | null | { warning: string } => {
  const normalized = normalizeCell(rawValue);
  if (!normalized || normalized.toLowerCase() === "x") {
    return null;
  }

  if (/^training day$/i.test(normalized)) {
    return {
      shiftType: "FULL_DAY",
      note: "Training day",
    };
  }

  if (/^(holiday|annual leave)$/i.test(normalized)) {
    return {
      shiftType: "HOLIDAY",
      note: normalized,
    };
  }

  const timeRange = parseLegacyTimeRange(normalized);
  if (!timeRange) {
    return {
      warning: `Unexpected rota value "${normalized}" for ${STORE_WEEKDAY_LABELS[weekday]}.`,
    };
  }

  const dayHours = openingHours[weekday];
  if (dayHours.isClosed) {
    return {
      warning: `Found "${normalized}" on ${STORE_WEEKDAY_LABELS[weekday]}, but Store Info marks that day as closed.`,
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
      shiftType: "FULL_DAY",
      note: null,
    };
  }

  return {
    warning: `Unexpected rota time "${normalized}" for ${STORE_WEEKDAY_LABELS[weekday]}; expected ${dayHours.opensAt}-${dayHours.closesAt} for FULL_DAY.`,
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
  const assignments: ParsedImportAssignment[] = [];
  const warnings: string[] = [];
  let skippedCells = 0;

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    const nextBlockRowIndex = blocks[blockIndex + 1]?.headerRowIndex ?? rows.length;

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

      const staffMatch = findMatchingStaff(staffName, staffLookup);
      if (staffMatch.warning) {
        warnings.push(`Row ${rowIndex + 1}: ${staffMatch.warning}`);
      }
      if (!staffMatch.staff) {
        skippedCells += 6;
        continue;
      }

      for (let offset = 0; offset < 6; offset += 1) {
        const weekday = weekdayForIndex(offset);
        const date = block.dates[weekday];
        const rawValue = row[block.startCol + offset] ?? "";
        const interpreted = interpretCellValue(rawValue, weekday, openingHours);

        if (interpreted === null) {
          skippedCells += 1;
          continue;
        }
        if ("warning" in interpreted) {
          warnings.push(`Row ${rowIndex + 1} ${STORE_WEEKDAY_LABELS[weekday]} ${date}: ${interpreted.warning}`);
          skippedCells += 1;
          continue;
        }

        assignments.push({
          staffId: staffMatch.staff.id,
          staffName: staffMatch.staff.name?.trim() || staffMatch.staff.username,
          date,
          shiftType: interpreted.shiftType,
          note: interpreted.note,
          rawValue: normalizeCell(rawValue),
        });
      }
    }
  }

  return {
    assignments,
    warnings,
    skippedCells,
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

  if (!parsed.assignments.length) {
    throw new HttpError(
      400,
      "No valid rota assignments were parsed from the spreadsheet export.",
      "INVALID_ROTA_IMPORT",
    );
  }

  const importedDates = [...new Set(parsed.assignments.map((assignment) => assignment.date))].sort();
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

  return {
    previewKey: buildPreviewKey(fileName, delimiter, spreadsheetText),
    fileName,
    detectedDelimiter: delimiter,
    period: rotaWindow,
    summary: {
      weekBlocks: blocks.length,
      parsedAssignments: parsed.assignments.length,
      skippedCells: parsed.skippedCells,
      warningCount: parsed.warnings.length,
      matchedStaffCount: new Set(parsed.assignments.map((assignment) => assignment.staffId)).size,
    },
    warnings: parsed.warnings,
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
  const earliestDate = [...new Set(parsed.assignments.map((assignment) => assignment.date))].sort()[0];
  const importBatchKey = buildImportBatchKey(fileName, settings.store.timeZone);

  let createdAssignments = 0;
  let updatedAssignments = 0;

  const rotaPeriod = await db.$transaction(async (tx) => {
    const selectedPeriod = await getOrCreateSixWeekRotaPeriod(earliestDate, tx);

    for (const assignment of parsed.assignments) {
      const existing = await tx.rotaAssignment.findUnique({
        where: {
          staffId_date: {
            staffId: assignment.staffId,
            date: assignment.date,
          },
        },
        select: { id: true },
      });

      await tx.rotaAssignment.upsert({
        where: {
          staffId_date: {
            staffId: assignment.staffId,
            date: assignment.date,
          },
        },
        create: {
          rotaPeriodId: selectedPeriod.id,
          staffId: assignment.staffId,
          date: assignment.date,
          shiftType: assignment.shiftType,
          source: RotaAssignmentSource.IMPORT,
          note: assignment.note,
          rawValue: assignment.rawValue,
          importBatchKey,
        },
        update: {
          rotaPeriodId: selectedPeriod.id,
          shiftType: assignment.shiftType,
          source: RotaAssignmentSource.IMPORT,
          note: assignment.note,
          rawValue: assignment.rawValue,
          importBatchKey,
        },
      });

      if (existing) {
        updatedAssignments += 1;
      } else {
        createdAssignments += 1;
      }
    }

    return selectedPeriod;
  });

  return {
    ...preview,
    importBatchKey,
    createdAssignments,
    updatedAssignments,
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
