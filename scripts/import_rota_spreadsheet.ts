import "dotenv/config";

import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient, RotaAssignmentSource, RotaShiftType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { listShopSettings } from "../src/services/configurationService";
import { buildSixWeekRotaWindow, getOrCreateSixWeekRotaPeriod } from "../src/services/rotaService";
import {
  clockTimeToMinutes,
  formatDateKeyInTimeZone,
  STORE_WEEKDAY_KEYS,
  STORE_WEEKDAY_LABELS,
  type StoreOpeningHoursSettings,
  type StoreWeekdayKey,
} from "../src/utils/storeHours";

type ParsedArgs = {
  filePath: string;
  apply: boolean;
  delimiter: "auto" | "," | "\t" | ";";
};

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

type ImportSummary = {
  weekBlocks: number;
  parsedAssignments: number;
  createdAssignments: number;
  updatedAssignments: number;
  skippedCells: number;
  warnings: string[];
};

const DATABASE_URL = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL or TEST_DATABASE_URL is required.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: DATABASE_URL,
  }),
});

const usage = () => {
  console.log(
    "Usage: ts-node --transpile-only scripts/import_rota_spreadsheet.ts --file <export.csv|export.tsv> [--apply] [--delimiter auto|comma|tab|semicolon]",
  );
};

const parseArgs = (argv: string[]): ParsedArgs => {
  let filePath = "";
  let apply = false;
  let delimiter: ParsedArgs["delimiter"] = "auto";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file" && argv[index + 1]) {
      filePath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      apply = false;
      continue;
    }
    if (arg === "--delimiter" && argv[index + 1]) {
      const rawDelimiter = argv[index + 1].toLowerCase();
      index += 1;
      if (rawDelimiter === "comma") {
        delimiter = ",";
      } else if (rawDelimiter === "tab") {
        delimiter = "\t";
      } else if (rawDelimiter === "semicolon") {
        delimiter = ";";
      } else {
        delimiter = "auto";
      }
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
  }

  if (!filePath) {
    usage();
    throw new Error("--file is required.");
  }

  return { filePath, apply, delimiter };
};

const detectDelimiter = (content: string, preferred: ParsedArgs["delimiter"]) => {
  if (preferred !== "auto") {
    return preferred;
  }

  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
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

const parseDelimitedText = (content: string, delimiter: string) => {
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

    if (!inQuotes && char === "\r") {
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
};

const normalizeCell = (value: string) => value.replace(/\s+/g, " ").trim();

const normalizeStaffKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

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
) => {
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

const summarizeAndPrint = (
  args: ParsedArgs,
  summary: ImportSummary,
  rotaPeriod: { startsOn: string; endsOn: string },
) => {
  console.log(`[rota-import] mode=${args.apply ? "apply" : "dry-run"}`);
  console.log(`[rota-import] file=${path.resolve(args.filePath)}`);
  console.log(`[rota-import] period=${rotaPeriod.startsOn}..${rotaPeriod.endsOn}`);
  console.log(`[rota-import] weekBlocks=${summary.weekBlocks}`);
  console.log(`[rota-import] parsedAssignments=${summary.parsedAssignments}`);
  console.log(`[rota-import] createdAssignments=${summary.createdAssignments}`);
  console.log(`[rota-import] updatedAssignments=${summary.updatedAssignments}`);
  console.log(`[rota-import] skippedCells=${summary.skippedCells}`);

  if (summary.warnings.length) {
    console.log("[rota-import] warnings:");
    for (const warning of summary.warnings) {
      console.log(`- ${warning}`);
    }
  } else {
    console.log("[rota-import] warnings: none");
  }
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const absoluteFilePath = path.resolve(args.filePath);
  const rawContent = fs.readFileSync(absoluteFilePath, "utf8").replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(rawContent, args.delimiter);
  const rows = parseDelimitedText(rawContent, delimiter);
  const blocks = detectSpreadsheetBlocks(rows);

  if (!blocks.length) {
    throw new Error("Could not detect any weekly rota blocks in the spreadsheet export.");
  }

  const staff = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      name: true,
      isActive: true,
    },
  });
  const staffLookup = buildStaffLookup(staff);

  const settings = await listShopSettings(prisma);
  const parsed = parseAssignmentsFromRows(rows, blocks, settings.store.openingHours, staffLookup);

  if (!parsed.assignments.length) {
    throw new Error("No valid rota assignments were parsed from the spreadsheet export.");
  }

  const importedDates = [...new Set(parsed.assignments.map((assignment) => assignment.date))].sort();
  const earliestDate = importedDates[0];
  const latestDate = importedDates[importedDates.length - 1];
  const rotaWindow = buildSixWeekRotaWindow(earliestDate);
  if (latestDate > rotaWindow.endsOn) {
    throw new Error(`Import spans beyond a single 6-week rota period (${rotaWindow.startsOn}..${rotaWindow.endsOn}).`);
  }

  const importBatchKey = `${path.basename(absoluteFilePath)}:${formatDateKeyInTimeZone(new Date(), settings.store.timeZone)}`;

  let createdAssignments = 0;
  let updatedAssignments = 0;

  if (args.apply) {
    await prisma.$transaction(async (tx) => {
      const rotaPeriod = await getOrCreateSixWeekRotaPeriod(earliestDate, tx);

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
            rotaPeriodId: rotaPeriod.id,
            staffId: assignment.staffId,
            date: assignment.date,
            shiftType: assignment.shiftType,
            source: RotaAssignmentSource.IMPORT,
            note: assignment.note,
            rawValue: assignment.rawValue,
            importBatchKey,
          },
          update: {
            rotaPeriodId: rotaPeriod.id,
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
    });
  }

  summarizeAndPrint(
    args,
    {
      weekBlocks: blocks.length,
      parsedAssignments: parsed.assignments.length,
      createdAssignments,
      updatedAssignments,
      skippedCells: parsed.skippedCells,
      warnings: parsed.warnings,
    },
    rotaWindow,
  );
};

run()
  .catch((error) => {
    console.error(`[rota-import] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
