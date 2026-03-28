import { Request, Response } from "express";
import { getRequestStaffActorId } from "../middleware/staffRole";
import { getBankHolidaySyncStatus, syncUkBankHolidays } from "../services/bankHolidayService";
import {
  confirmRotaSpreadsheetImport,
  downloadRotaTemplate,
  exportRotaPeriodSpreadsheet,
  previewRotaSpreadsheetImport,
} from "../services/rotaImportService";
import { clearRotaAssignment, createRotaPeriod, getRotaOverview, saveBulkRotaAssignments, saveManualRotaAssignment } from "../services/rotaService";
import { HttpError } from "../utils/http";
import { RotaShiftType } from "@prisma/client";

const parseImportBody = (body: unknown, requirePreviewKey = false) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "rota import body must be an object", "INVALID_ROTA_IMPORT");
  }

  const record = body as {
    spreadsheetText?: unknown;
    fileName?: unknown;
    delimiter?: unknown;
    previewKey?: unknown;
  };

  if (typeof record.spreadsheetText !== "string") {
    throw new HttpError(400, "spreadsheetText must be a string", "INVALID_ROTA_IMPORT");
  }
  if (record.fileName !== undefined && typeof record.fileName !== "string") {
    throw new HttpError(400, "fileName must be a string", "INVALID_ROTA_IMPORT");
  }
  if (record.delimiter !== undefined && typeof record.delimiter !== "string") {
    throw new HttpError(400, "delimiter must be a string", "INVALID_ROTA_IMPORT");
  }
  if (requirePreviewKey && typeof record.previewKey !== "string") {
    throw new HttpError(400, "previewKey must be a string", "INVALID_ROTA_IMPORT_CONFIRM");
  }

  return {
    spreadsheetText: record.spreadsheetText,
    fileName: record.fileName,
    delimiter: record.delimiter,
    previewKey: record.previewKey,
  };
};

const isRotaShiftType = (value: string): value is RotaShiftType =>
  value === "FULL_DAY" ||
  value === "HALF_DAY_AM" ||
  value === "HALF_DAY_PM" ||
  value === "HOLIDAY";

const parseAssignmentBody = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "rota assignment body must be an object", "INVALID_ROTA_ASSIGNMENT");
  }

  const record = body as {
    rotaPeriodId?: unknown;
    staffId?: unknown;
    date?: unknown;
    shiftType?: unknown;
  };

  if (typeof record.rotaPeriodId !== "string" || !record.rotaPeriodId.trim()) {
    throw new HttpError(400, "rotaPeriodId must be a string", "INVALID_ROTA_ASSIGNMENT");
  }
  if (typeof record.staffId !== "string" || !record.staffId.trim()) {
    throw new HttpError(400, "staffId must be a string", "INVALID_ROTA_ASSIGNMENT");
  }
  if (typeof record.date !== "string" || !record.date.trim()) {
    throw new HttpError(400, "date must be a string", "INVALID_ROTA_ASSIGNMENT");
  }
  if (typeof record.shiftType !== "string" || !isRotaShiftType(record.shiftType.trim().toUpperCase())) {
    throw new HttpError(
      400,
      "shiftType must be FULL_DAY, HALF_DAY_AM, HALF_DAY_PM, or HOLIDAY",
      "INVALID_ROTA_ASSIGNMENT",
    );
  }

  return {
    rotaPeriodId: record.rotaPeriodId.trim(),
    staffId: record.staffId.trim(),
    date: record.date.trim(),
    shiftType: record.shiftType.trim().toUpperCase() as RotaShiftType,
  };
};

const parseBulkAssignmentBody = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "rota assignment body must be an object", "INVALID_ROTA_ASSIGNMENT");
  }

  const record = body as {
    rotaPeriodId?: unknown;
    staffId?: unknown;
    changes?: unknown;
  };

  if (typeof record.rotaPeriodId !== "string" || !record.rotaPeriodId.trim()) {
    throw new HttpError(400, "rotaPeriodId must be a string", "INVALID_ROTA_ASSIGNMENT");
  }
  if (typeof record.staffId !== "string" || !record.staffId.trim()) {
    throw new HttpError(400, "staffId must be a string", "INVALID_ROTA_ASSIGNMENT");
  }
  if (!Array.isArray(record.changes) || record.changes.length === 0) {
    throw new HttpError(400, "changes must be a non-empty array", "INVALID_ROTA_ASSIGNMENT");
  }

  return {
    rotaPeriodId: record.rotaPeriodId.trim(),
    staffId: record.staffId.trim(),
    changes: record.changes.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new HttpError(400, "each change must be an object", "INVALID_ROTA_ASSIGNMENT");
      }

      const change = entry as {
        date?: unknown;
        shiftType?: unknown;
      };

      if (typeof change.date !== "string" || !change.date.trim()) {
        throw new HttpError(400, "change date must be a string", "INVALID_ROTA_ASSIGNMENT");
      }
      if (
        typeof change.shiftType !== "string"
        || (
          !isRotaShiftType(change.shiftType.trim().toUpperCase())
          && change.shiftType.trim().toUpperCase() !== "OFF"
        )
      ) {
        throw new HttpError(
          400,
          "change shiftType must be FULL_DAY, HALF_DAY_AM, HALF_DAY_PM, HOLIDAY, or OFF",
          "INVALID_ROTA_ASSIGNMENT",
        );
      }

      return {
        date: change.date.trim(),
        shiftType: change.shiftType.trim().toUpperCase() as RotaShiftType | "OFF",
      };
    }),
  };
};

const parseCreatePeriodBody = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "rota period body must be an object", "INVALID_ROTA_PERIOD");
  }

  const record = body as {
    startsOn?: unknown;
    label?: unknown;
    notes?: unknown;
  };

  if (typeof record.startsOn !== "string" || !record.startsOn.trim()) {
    throw new HttpError(400, "startsOn must be a string", "INVALID_ROTA_PERIOD");
  }
  if (record.label !== undefined && typeof record.label !== "string") {
    throw new HttpError(400, "label must be a string", "INVALID_ROTA_PERIOD");
  }
  if (record.notes !== undefined && record.notes !== null && typeof record.notes !== "string") {
    throw new HttpError(400, "notes must be a string or null", "INVALID_ROTA_PERIOD");
  }

  return {
    startsOn: record.startsOn.trim(),
    label: typeof record.label === "string" ? record.label.trim() : undefined,
    notes: typeof record.notes === "string" ? record.notes : record.notes ?? undefined,
  };
};

export const listRotaOverviewHandler = async (req: Request, res: Response) => {
  const periodId = typeof req.query.periodId === "string" ? req.query.periodId.trim() : undefined;
  const staffScope = typeof req.query.staffScope === "string" ? req.query.staffScope.trim() : undefined;
  const role = typeof req.query.role === "string" ? req.query.role.trim() : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
  const overview = await getRotaOverview({ periodId, staffScope, role, search });
  res.json(overview);
};

export const previewRotaImportHandler = async (req: Request, res: Response) => {
  const body = parseImportBody(req.body);
  const preview = await previewRotaSpreadsheetImport(body);
  res.json(preview);
};

export const downloadRotaTemplateHandler = async (req: Request, res: Response) => {
  const startsOn = typeof req.query.startsOn === "string" ? req.query.startsOn.trim() : undefined;
  const result = await downloadRotaTemplate({ startsOn });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
  res.send(result.content);
};

export const exportRotaPeriodHandler = async (req: Request, res: Response) => {
  const rotaPeriodId = typeof req.params.periodId === "string" ? req.params.periodId.trim() : "";
  const result = await exportRotaPeriodSpreadsheet({ rotaPeriodId });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
  res.send(result.content);
};

export const confirmRotaImportHandler = async (req: Request, res: Response) => {
  const body = parseImportBody(req.body, true);
  const result = await confirmRotaSpreadsheetImport({
    ...body,
    createdByStaffId: getRequestStaffActorId(req),
  });
  res.status(201).json(result);
};

export const saveRotaAssignmentHandler = async (req: Request, res: Response) => {
  const body = parseAssignmentBody(req.body);
  const result = await saveManualRotaAssignment(body);
  res.status(201).json(result);
};

export const saveBulkRotaAssignmentHandler = async (req: Request, res: Response) => {
  const body = parseBulkAssignmentBody(req.body);
  const result = await saveBulkRotaAssignments(body);
  res.status(201).json(result);
};

export const createRotaPeriodHandler = async (req: Request, res: Response) => {
  const body = parseCreatePeriodBody(req.body);
  const result = await createRotaPeriod(body);
  res.status(result.created ? 201 : 200).json(result);
};

export const clearRotaAssignmentHandler = async (req: Request, res: Response) => {
  const assignmentId = typeof req.params.assignmentId === "string" ? req.params.assignmentId.trim() : "";
  const result = await clearRotaAssignment({ assignmentId });
  res.json(result);
};

export const bankHolidayStatusHandler = async (_req: Request, res: Response) => {
  const status = await getBankHolidaySyncStatus();
  res.json(status);
};

export const syncBankHolidaysHandler = async (req: Request, res: Response) => {
  const result = await syncUkBankHolidays({
    syncedByStaffId: getRequestStaffActorId(req) ?? undefined,
  });
  res.json(result);
};
