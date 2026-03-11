import { Request, Response } from "express";
import {
  getCustomerServiceRemindersReport,
  getInventoryOnHandReport,
  getInventoryVelocityReport,
  getInventoryValueReport,
  getPaymentsReport,
  getCustomerInsightsReport,
  getInventoryLocationSummaryReport,
  getOperationsExceptions,
  getPricingExceptionsReport,
  getInventoryReorderSuggestionsReport,
  getInventoryVelocity,
  getProductSalesReport,
  getSalesDailyReport,
  getSupplierPerformanceReport,
  getWorkshopCapacityReport,
  getWorkshopWarrantyReport,
  getWorkshopDailyReport,
} from "../services/reportService";
import { toCsv } from "../utils/csv";

const getDateRangeQuery = (req: Request) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  return { from, to };
};

const getLocationIdQuery = (req: Request) =>
  (typeof req.query.locationId === "string" ? req.query.locationId : undefined);

const getTakeQuery = (req: Request) => {
  if (req.query.take === undefined) {
    return undefined;
  }

  const value = Number(req.query.take);
  return Number.isNaN(value) ? undefined : value;
};

const getIntQuery = (req: Request, key: string) => {
  if (req.query[key] === undefined) {
    return undefined;
  }

  const raw = req.query[key];
  const value = typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isNaN(value) ? undefined : value;
};

const sendCsv = (res: Response, filename: string, csv: string) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(csv);
};

export const getSalesDailyReportHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const report = await getSalesDailyReport(from, to);
  res.json(report);
};

export const getWorkshopDailyReportHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const report = await getWorkshopDailyReport(from, to);
  res.json(report);
};

export const getWorkshopCapacityReportHandler = async (_req: Request, res: Response) => {
  const report = await getWorkshopCapacityReport();
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
  const rows = await getSalesDailyReport(from, to);

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
  const rows = await getWorkshopDailyReport(from, to);

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

export const getProductSalesReportHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const report = await getProductSalesReport(from, to, getTakeQuery(req));
  res.json(report);
};

export const getInventoryVelocityReportHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const report = await getInventoryVelocityReport(from, to, getTakeQuery(req));
  res.json(report);
};

export const getInventoryVelocityHandler = async (_req: Request, res: Response) => {
  const report = await getInventoryVelocity();
  res.json(report);
};

export const getInventoryReorderSuggestionsReportHandler = async (req: Request, res: Response) => {
  const report = await getInventoryReorderSuggestionsReport(getTakeQuery(req));
  res.json(report);
};

export const getPricingExceptionsReportHandler = async (_req: Request, res: Response) => {
  const report = await getPricingExceptionsReport();
  res.json(report);
};

export const getOperationsExceptionsHandler = async (_req: Request, res: Response) => {
  const report = await getOperationsExceptions();
  res.json(report);
};

export const getInventoryLocationSummaryReportHandler = async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const active = typeof req.query.active === "string" ? req.query.active : undefined;
  const locationId = getLocationIdQuery(req);
  const take = getTakeQuery(req);
  const report = await getInventoryLocationSummaryReport({
    ...(q === undefined ? {} : { q }),
    ...(active === undefined ? {} : { active }),
    ...(locationId === undefined ? {} : { locationId }),
    ...(take === undefined ? {} : { take }),
  });
  res.json(report);
};

export const getSupplierPerformanceReportHandler = async (req: Request, res: Response) => {
  const report = await getSupplierPerformanceReport();
  res.json(report);
};

export const getCustomerInsightsReportHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const report = await getCustomerInsightsReport(from, to, getTakeQuery(req));
  res.json(report);
};

export const getCustomerServiceRemindersReportHandler = async (req: Request, res: Response) => {
  const report = await getCustomerServiceRemindersReport(
    getIntQuery(req, "dueSoonDays"),
    getIntQuery(req, "overdueDays"),
    getIntQuery(req, "lookbackDays"),
    getTakeQuery(req),
  );
  res.json(report);
};

export const getWorkshopWarrantyReportHandler = async (req: Request, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const report = await getWorkshopWarrantyReport(status, search, getTakeQuery(req));
  res.json(report);
};
