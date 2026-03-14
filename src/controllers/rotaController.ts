import { Request, Response } from "express";
import { getRequestStaffActorId } from "../middleware/staffRole";
import { confirmRotaSpreadsheetImport, previewRotaSpreadsheetImport } from "../services/rotaImportService";
import { getRotaOverview } from "../services/rotaService";
import { HttpError } from "../utils/http";

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

export const listRotaOverviewHandler = async (req: Request, res: Response) => {
  const periodId = typeof req.query.periodId === "string" ? req.query.periodId.trim() : undefined;
  const overview = await getRotaOverview({ periodId });
  res.json(overview);
};

export const previewRotaImportHandler = async (req: Request, res: Response) => {
  const body = parseImportBody(req.body);
  const preview = await previewRotaSpreadsheetImport(body);
  res.json(preview);
};

export const confirmRotaImportHandler = async (req: Request, res: Response) => {
  const body = parseImportBody(req.body, true);
  const result = await confirmRotaSpreadsheetImport({
    ...body,
    createdByStaffId: getRequestStaffActorId(req),
  });
  res.status(201).json(result);
};
