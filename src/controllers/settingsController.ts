import { Request, Response } from "express";
import {
  listShopSettings,
  listStoreInfoSettings,
  updateShopSettings,
  updateStoreInfoSettings,
} from "../services/configurationService";
import { removeStoreLogo, uploadStoreLogo } from "../services/storeLogoService";
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

export const listStoreInfoHandler = async (_req: Request, res: Response) => {
  const store = await listStoreInfoSettings();
  res.json({ store });
};

export const updateStoreInfoHandler = async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new HttpError(400, "store info patch body must be an object", "INVALID_SETTINGS");
  }

  const store = await updateStoreInfoSettings(
    req.body as Parameters<typeof updateStoreInfoSettings>[0],
  );
  res.json({ store });
};

export const uploadStoreLogoHandler = async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new HttpError(400, "store logo upload body must be an object", "INVALID_STORE_LOGO");
  }

  const body = req.body as { fileDataUrl?: unknown };
  if (typeof body.fileDataUrl !== "string") {
    throw new HttpError(400, "fileDataUrl must be a string", "INVALID_STORE_LOGO");
  }

  const store = await uploadStoreLogo({ fileDataUrl: body.fileDataUrl });
  res.status(201).json({ store });
};

export const removeStoreLogoHandler = async (_req: Request, res: Response) => {
  const store = await removeStoreLogo();
  res.json({ store });
};
