import { Request, Response } from "express";
import {
  getInventoryOnHandReport,
  getInventoryValueReport,
  getPaymentsReport,
  getSalesDailyReport,
  getWorkshopDailyReport,
} from "../services/reportService";
import { resolveRequestLocation } from "../services/locationService";
import { toCsv } from "../utils/csv";

const getDateRangeQuery = (req: Request) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  return { from, to };
};

const getLocationIdQuery = (req: Request) =>
  (typeof req.query.locationId === "string" ? req.query.locationId : undefined);

const sendCsv = (res: Response, filename: string, csv: string) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(csv);
};

export const getSalesDailyReportHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const location = await resolveRequestLocation(req);
  const report = await getSalesDailyReport(from, to, location.id);
  res.json(report);
};

export const getWorkshopDailyReportHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const location = await resolveRequestLocation(req);
  const report = await getWorkshopDailyReport(from, to, location.id);
  res.json(report);
};

export const getInventoryOnHandReportHandler = async (req: Request, res: Response) => {
  const report = await getInventoryOnHandReport(getLocationIdQuery(req));
  res.json(report);
};

export const getInventoryValueReportHandler = async (req: Request, res: Response) => {
  const report = await getInventoryValueReport(getLocationIdQuery(req));
  res.json(report);
};

export const getSalesDailyReportCsvHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const location = await resolveRequestLocation(req);
  const rows = await getSalesDailyReport(from, to, location.id);

  const csv = toCsv(rows, [
    { header: "date", value: (row) => row.date },
    { header: "saleCount", value: (row) => row.saleCount },
    { header: "grossPence", value: (row) => row.grossPence },
    { header: "refundsPence", value: (row) => row.refundsPence },
    { header: "netPence", value: (row) => row.netPence },
  ]);

  sendCsv(res, "sales_daily.csv", csv);
};

export const getWorkshopDailyReportCsvHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const location = await resolveRequestLocation(req);
  const rows = await getWorkshopDailyReport(from, to, location.id);

  const csv = toCsv(rows, [
    { header: "date", value: (row) => row.date },
    { header: "jobCount", value: (row) => row.jobCount },
    { header: "revenuePence", value: (row) => row.revenuePence },
  ]);

  sendCsv(res, "workshop_daily.csv", csv);
};

export const getInventoryOnHandReportCsvHandler = async (req: Request, res: Response) => {
  const rows = await getInventoryOnHandReport(getLocationIdQuery(req));

  const csv = toCsv(rows, [
    { header: "variantId", value: (row) => row.variantId },
    { header: "productName", value: (row) => row.productName },
    { header: "option", value: (row) => row.option },
    { header: "barcode", value: (row) => row.barcode },
    { header: "onHand", value: (row) => row.onHand },
  ]);

  sendCsv(res, "inventory_on_hand.csv", csv);
};

export const getInventoryValueReportCsvHandler = async (req: Request, res: Response) => {
  const report = await getInventoryValueReport(getLocationIdQuery(req));

  const csv = toCsv(report.breakdown, [
    { header: "variantId", value: (row) => row.variantId },
    { header: "onHand", value: (row) => row.onHand },
    { header: "avgUnitCostPence", value: (row) => row.avgUnitCostPence },
    { header: "valuePence", value: (row) => row.valuePence },
  ]);

  sendCsv(res, "inventory_value.csv", csv);
};

export const getPaymentsReportCsvHandler = async (req: Request, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
  const { from, to } = getDateRangeQuery(req);
  const filters: { status?: string; provider?: string; from?: string; to?: string } = {};
  if (status !== undefined) {
    filters.status = status;
  }
  if (provider !== undefined) {
    filters.provider = provider;
  }
  if (from !== undefined) {
    filters.from = from;
  }
  if (to !== undefined) {
    filters.to = to;
  }
  const rows = await getPaymentsReport(filters);

  const csv = toCsv(rows, [
    { header: "intentId", value: (row) => row.intentId },
    { header: "provider", value: (row) => row.provider },
    { header: "status", value: (row) => row.status },
    { header: "amount", value: (row) => row.amount },
    { header: "saleId", value: (row) => row.saleId },
    { header: "timestamp", value: (row) => row.timestamp },
  ]);

  sendCsv(res, "payments.csv", csv);
};
