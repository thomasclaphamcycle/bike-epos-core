import { Request, Response } from "express";
import { getRequestStaffActorId } from "../middleware/staffRole";
import { confirmProductCsvImport, previewProductCsvImport } from "../services/productImportService";
import { HttpError } from "../utils/http";

export const previewProductCsvImportHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    csvText?: unknown;
  };

  if (typeof body.csvText !== "string") {
    throw new HttpError(400, "csvText must be a string", "INVALID_PRODUCT_IMPORT");
  }

  const preview = await previewProductCsvImport({
    csvText: body.csvText,
  });
  res.json(preview);
};

export const confirmProductCsvImportHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    csvText?: unknown;
    previewKey?: unknown;
  };

  if (typeof body.csvText !== "string") {
    throw new HttpError(400, "csvText must be a string", "INVALID_PRODUCT_IMPORT_CONFIRM");
  }
  if (typeof body.previewKey !== "string") {
    throw new HttpError(400, "previewKey must be a string", "INVALID_PRODUCT_IMPORT_CONFIRM");
  }

  const result = await confirmProductCsvImport({
    csvText: body.csvText,
    previewKey: body.previewKey,
    createdByStaffId: getRequestStaffActorId(req),
  });

  res.status(201).json(result);
};
