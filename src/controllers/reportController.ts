import { Request, Response } from "express";
import { logCorePosEvent, logOperationalEvent } from "../lib/operationalLogger";
import {
  getActionCentreReport,
  getCustomerServiceRemindersReport,
  getDailyCloseReport,
  getFinancialMonthlyMarginSummary,
  getFinancialMonthlySalesSummary,
  getInventoryInvestigationsReport,
  getInventoryOnHandReport,
  getInventoryVelocityReport,
  getInventoryValueReport,
  getInventoryValueSnapshotReport,
  getFinancialMonthlyMarginReport,
  getFinancialMonthlySalesSummaryReport,
  getFinancialSalesByCategoryReport,
  getPaymentsReport,
  getCustomerInsightsReport,
  getInventoryLocationSummaryReport,
  getOperationsExceptions,
  getPricingExceptionsReport,
  getReminderCandidatesReport,
  getInventoryReorderSuggestionsReport,
  getInventoryVelocity,
  getProductSalesReport,
  importHistoricalFinancialSummaries,
  getSalesDailyReport,
  getSupplierPerformanceReport,
  getSupplierCostHistoryReport,
  getWorkshopCapacityReport,
  getWorkshopAnalyticsReport,
  getWorkshopWarrantyReport,
  getWorkshopDailyReport,
  runDailyCloseReport,
} from "../services/reportService";
import { resolveRequestLocation } from "../services/locationService";
import {
  dismissReminderCandidateWithActor,
  markReminderCandidateReviewed,
} from "../services/reminderCandidateService";
import { toCsv } from "../utils/csv";
import { HttpError } from "../utils/http";
import { parseOptionalIntegerQuery } from "../utils/requestParsing";
import { getRequestAuditActor, getRequestStaffActorId } from "../middleware/staffRole";

const getDateRangeQuery = (req: Request) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  return { from, to };
};

const getLocationIdQuery = (req: Request) =>
  (typeof req.query.locationId === "string" ? req.query.locationId : undefined);

const getAsOfQuery = (req: Request) =>
  (typeof req.query.asOf === "string" ? req.query.asOf : undefined);

const getTakeQuery = (req: Request) => {
  return parseOptionalIntegerQuery(req.query.take, {
    code: "INVALID_REPORT_FILTER",
    message: "take must be an integer",
  });
};

const getIntQuery = (req: Request, key: string) => {
  return parseOptionalIntegerQuery(req.query[key], {
    code: "INVALID_REPORT_FILTER",
    message: `${key} must be an integer`,
  });
};

const getBooleanQuery = (req: Request, key: string) => {
  if (req.query[key] === undefined) {
    return undefined;
  }

  const raw = req.query[key];
  if (raw === "1" || raw === "true") {
    return true;
  }
  if (raw === "0" || raw === "false") {
    return false;
  }

  throw new HttpError(400, `${key} must be 1, 0, true, or false`, "INVALID_REPORT_FILTER");
};

const sendCsv = (res: Response, filename: string, csv: string) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(csv);
};

export const getSalesDailyReportHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const location = await resolveRequestLocation(req);
  const report = await getSalesDailyReport(from, to, location.locationId ?? location.id);
  res.json(report);
};

export const getWorkshopDailyReportHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const location = await resolveRequestLocation(req);
  const report = await getWorkshopDailyReport(from, to, location.locationId ?? location.id);
  res.json(report);
};

export const getWorkshopCapacityReportHandler = async (_req: Request, res: Response) => {
  const report = await getWorkshopCapacityReport();
  res.json(report);
};

export const getWorkshopAnalyticsReportHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const location = await resolveRequestLocation(req);
  const report = await getWorkshopAnalyticsReport(from, to, location.locationId ?? location.id);
  res.json(report);
};

export const getFinancialMonthlyMarginReportHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const report = await getFinancialMonthlyMarginReport(from, to);
  res.json(report);
};

export const getFinancialMonthlySalesReportHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const report = await getFinancialMonthlySalesSummaryReport(from, to);
  res.json(report);
};

export const getFinancialSalesByCategoryReportHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const report = await getFinancialSalesByCategoryReport(from, to);
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

export const getInventoryValueSnapshotReportHandler = async (_req: Request, res: Response) => {
  const report = await getInventoryValueSnapshotReport();
  res.json(report);
};

export const getSalesDailyReportCsvHandler = async (req: Request, res: Response) => {
  const { from, to } = getDateRangeQuery(req);
  const location = await resolveRequestLocation(req);
  const rows = await getSalesDailyReport(from, to, location.locationId ?? location.id);

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
  const rows = await getWorkshopDailyReport(from, to, location.locationId ?? location.id);

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

export const importHistoricalFinancialSummariesHandler = async (req: Request, res: Response) => {
  const csv =
    typeof req.body === "string"
      ? req.body
      : req.body && typeof req.body === "object" && typeof (req.body as { csv?: unknown }).csv === "string"
        ? (req.body as { csv: string }).csv
        : null;

  if (!csv) {
    throw new HttpError(
      400,
      "Historical summary import expects raw text/csv or a JSON body with a csv field",
      "INVALID_HISTORICAL_SUMMARY_CSV",
    );
  }

  const result = await importHistoricalFinancialSummaries(csv);
  logOperationalEvent("reports.historical_summary.imported", {
    resultStatus: result.skippedCount > 0 ? "partial" : "succeeded",
    importedCount: result.importedCount,
    skippedCount: result.skippedCount,
    actorId: getRequestStaffActorId(req),
  });
  res.status(201).json(result);
};

export const getFinancialMonthlySalesSummaryHandler = async (req: Request, res: Response) => {
  const report = await getFinancialMonthlySalesSummary(getAsOfQuery(req));
  res.json(report);
};

export const getFinancialMonthlyMarginSummaryHandler = async (req: Request, res: Response) => {
  const report = await getFinancialMonthlyMarginSummary(getAsOfQuery(req));
  res.json(report);
};

export const runDailyCloseHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { date?: unknown; locationCode?: unknown };

  if (body.date !== undefined && typeof body.date !== "string") {
    throw new HttpError(400, "date must be a string", "INVALID_DAILY_CLOSE");
  }
  if (body.locationCode !== undefined && typeof body.locationCode !== "string") {
    throw new HttpError(400, "locationCode must be a string", "INVALID_DAILY_CLOSE");
  }

  const input: {
    date?: string;
    locationCode?: string;
    auditActor: ReturnType<typeof getRequestAuditActor>;
  } = {
    auditActor: getRequestAuditActor(req),
  };

  if (body.date !== undefined) {
    input.date = body.date;
  }
  if (body.locationCode !== undefined) {
    input.locationCode = body.locationCode;
  }

  const report = await runDailyCloseReport(input);
  logCorePosEvent("reports.daily_close.generated", {
    resultStatus: "succeeded",
    actorId: getRequestStaffActorId(req),
    date: report.date,
    locationId: report.location.id,
    salesCount: report.sales.count,
    totalTakingsPence: report.netSalesPence,
  });
  res.status(201).json(report);
};

export const getDailyCloseHandler = async (req: Request, res: Response) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  const locationCode =
    typeof req.query.locationCode === "string" ? req.query.locationCode : undefined;

  const input: { date?: string; locationCode?: string } = {};
  if (date !== undefined) {
    input.date = date;
  }
  if (locationCode !== undefined) {
    input.locationCode = locationCode;
  }

  const report = await getDailyCloseReport(input);
  res.json(report);
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
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const report = await getInventoryReorderSuggestionsReport(getTakeQuery(req), q);
  res.json(report);
};

export const getInventoryInvestigationsReportHandler = async (_req: Request, res: Response) => {
  const report = await getInventoryInvestigationsReport();
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

export const getActionCentreReportHandler = async (_req: Request, res: Response) => {
  const report = await getActionCentreReport();
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

export const getSupplierCostHistoryReportHandler = async (req: Request, res: Response) => {
  const report = await getSupplierCostHistoryReport(getTakeQuery(req));
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

export const getReminderCandidatesReportHandler = async (req: Request, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const report = await getReminderCandidatesReport(
    status,
    getTakeQuery(req),
    getBooleanQuery(req, "includeDismissed"),
  );
  res.json(report);
};

export const markReminderCandidateReviewedHandler = async (req: Request, res: Response) => {
  const reminderCandidateId = typeof req.params.reminderCandidateId === "string"
    ? req.params.reminderCandidateId
    : "";
  const result = await markReminderCandidateReviewed(
    reminderCandidateId,
    getRequestStaffActorId(req),
  );
  res.status(result.idempotent ? 200 : 201).json(result);
};

export const dismissReminderCandidateHandler = async (req: Request, res: Response) => {
  const reminderCandidateId = typeof req.params.reminderCandidateId === "string"
    ? req.params.reminderCandidateId
    : "";
  const result = await dismissReminderCandidateWithActor(
    reminderCandidateId,
    getRequestStaffActorId(req),
  );
  res.status(result.idempotent ? 200 : 201).json(result);
};

export const getWorkshopWarrantyReportHandler = async (req: Request, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const report = await getWorkshopWarrantyReport(status, search, getTakeQuery(req));
  res.json(report);
};
