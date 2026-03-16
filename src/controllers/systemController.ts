import { Request, Response } from "express";
import { getRuntimeVersionInfo } from "../services/systemService";

export const getSystemVersionHandler = (_req: Request, res: Response) => {
  res.json(getRuntimeVersionInfo());
};
