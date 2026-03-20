import { Request, Response } from "express";
import { listPublicShopConfig } from "../services/configurationService";

export const getConfigHandler = async (_req: Request, res: Response) => {
  const config = await listPublicShopConfig();
  res.json({ config });
};
