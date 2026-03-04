import { Request, Response } from "express";
import { listStockLocations } from "../services/locationService";

export const listStockLocationsHandler = async (_req: Request, res: Response) => {
  const result = await listStockLocations();
  res.json(result);
};
