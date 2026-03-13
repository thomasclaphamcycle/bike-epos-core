import { Request, Response } from "express";
import { listShopSettings, updateShopSettings } from "../services/configurationService";
import { HttpError } from "../utils/http";

export const listSettingsHandler = async (_req: Request, res: Response) => {
  const settings = await listShopSettings();
  res.json({ settings });
};

export const updateSettingsHandler = async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new HttpError(400, "settings patch body must be an object", "INVALID_SETTINGS");
  }

  const settings = await updateShopSettings(req.body as Parameters<typeof updateShopSettings>[0]);
  res.json({ settings });
};
