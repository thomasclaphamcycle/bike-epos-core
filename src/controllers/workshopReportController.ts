import { Request, Response } from "express";
import {
  getWorkshopCreditsReport,
  getWorkshopDepositsReport,
  getWorkshopPaymentsReport,
} from "../services/workshopReportService";

const getRangeQuery = (req: Request) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  return { from, to };
};

export const getWorkshopPaymentsReportHandler = async (
  req: Request,
  res: Response,
) => {
  const { from, to } = getRangeQuery(req);
  const report = await getWorkshopPaymentsReport(from, to);
  res.json(report);
};

export const getWorkshopDepositsReportHandler = async (
  req: Request,
  res: Response,
) => {
  const { from, to } = getRangeQuery(req);
  const report = await getWorkshopDepositsReport(from, to);
  res.json(report);
};

export const getWorkshopCreditsReportHandler = async (
  req: Request,
  res: Response,
) => {
  const { from, to } = getRangeQuery(req);
  const report = await getWorkshopCreditsReport(from, to);
  res.json(report);
};
