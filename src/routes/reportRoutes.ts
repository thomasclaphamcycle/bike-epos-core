import express, { Router } from "express";
import {
  dismissReminderCandidateHandler,
  getActionCentreReportHandler,
  getBusinessIntelligenceReportHandler,
  getCustomerServiceRemindersReportHandler,
  getDailyCloseHandler,
  getFinancialMonthlyMarginReportHandler,
  getFinancialMonthlyMarginSummaryHandler,
  getFinancialMonthlySalesReportHandler,
  getFinancialMonthlySalesSummaryHandler,
  getFinancialSalesByCategoryReportHandler,
  getInventoryInvestigationsReportHandler,
  getInventoryOnHandReportHandler,
  getInventoryOnHandReportCsvHandler,
  getInventoryReorderSuggestionsReportHandler,
  getInventoryVelocityHandler,
  getInventoryVelocityReportHandler,
  getInventoryValueReportHandler,
  getInventoryValueSnapshotReportHandler,
  getInventoryValueReportCsvHandler,
  getOperationsExceptionsHandler,
  getPaymentsReportCsvHandler,
  getPricingExceptionsReportHandler,
  getReminderCandidatesReportHandler,
  getCustomerInsightsReportHandler,
  getInventoryLocationSummaryReportHandler,
  getProductSalesReportHandler,
  importHistoricalFinancialSummariesHandler,
  getSalesDailyReportHandler,
  getSalesDailyReportCsvHandler,
  getSupplierCostHistoryReportHandler,
  getSupplierPerformanceReportHandler,
  getWorkshopCapacityReportHandler,
  getWorkshopAnalyticsReportHandler,
  getWorkshopDailyReportHandler,
  getWorkshopDailyReportCsvHandler,
  getWorkshopWarrantyReportHandler,
  markReminderCandidateReviewedHandler,
  runDailyCloseHandler,
} from "../controllers/reportController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const reportRouter = Router();

reportRouter.get("/sales/daily", requireRoleAtLeast("MANAGER"), getSalesDailyReportHandler);
reportRouter.get("/sales/daily.csv", requireRoleAtLeast("MANAGER"), getSalesDailyReportCsvHandler);
reportRouter.get(
  "/business-intelligence",
  requireRoleAtLeast("MANAGER"),
  getBusinessIntelligenceReportHandler,
);
reportRouter.get(
  "/financial/monthly-sales-summary",
  requireRoleAtLeast("MANAGER"),
  getFinancialMonthlySalesSummaryHandler,
);
reportRouter.get(
  "/financial/monthly-margin-summary",
  requireRoleAtLeast("MANAGER"),
  getFinancialMonthlyMarginSummaryHandler,
);
reportRouter.post(
  "/financial/historical-summary/import",
  requireRoleAtLeast("MANAGER"),
  express.text({ type: ["text/csv", "text/plain", "application/csv"] }),
  importHistoricalFinancialSummariesHandler,
);
reportRouter.get("/daily-close", requireRoleAtLeast("MANAGER"), getDailyCloseHandler);
reportRouter.post("/daily-close", requireRoleAtLeast("MANAGER"), runDailyCloseHandler);
reportRouter.get("/financial/monthly-margin", requireRoleAtLeast("MANAGER"), getFinancialMonthlyMarginReportHandler);
reportRouter.get("/financial/monthly-sales", requireRoleAtLeast("MANAGER"), getFinancialMonthlySalesReportHandler);
reportRouter.get("/financial/sales-by-category", requireRoleAtLeast("MANAGER"), getFinancialSalesByCategoryReportHandler);
reportRouter.get("/workshop/daily", requireRoleAtLeast("MANAGER"), getWorkshopDailyReportHandler);
reportRouter.get(
  "/workshop/daily.csv",
  requireRoleAtLeast("MANAGER"),
  getWorkshopDailyReportCsvHandler,
);
reportRouter.get("/inventory/on-hand", getInventoryOnHandReportHandler);
reportRouter.get(
  "/inventory/on-hand.csv",
  requireRoleAtLeast("MANAGER"),
  getInventoryOnHandReportCsvHandler,
);
reportRouter.get("/inventory/value", getInventoryValueReportHandler);
reportRouter.get("/inventory/value-snapshot", requireRoleAtLeast("MANAGER"), getInventoryValueSnapshotReportHandler);
reportRouter.get(
  "/inventory/value.csv",
  requireRoleAtLeast("MANAGER"),
  getInventoryValueReportCsvHandler,
);
reportRouter.get("/payments", requireRoleAtLeast("MANAGER"), getPaymentsReportCsvHandler);
reportRouter.get("/sales/products", requireRoleAtLeast("MANAGER"), getProductSalesReportHandler);
reportRouter.get("/inventory/location-summary", requireRoleAtLeast("STAFF"), getInventoryLocationSummaryReportHandler);
reportRouter.get("/inventory-velocity", requireRoleAtLeast("MANAGER"), getInventoryVelocityHandler);
reportRouter.get("/inventory/investigations", requireRoleAtLeast("MANAGER"), getInventoryInvestigationsReportHandler);
reportRouter.get("/inventory/velocity", requireRoleAtLeast("MANAGER"), getInventoryVelocityReportHandler);
reportRouter.get("/inventory/reorder-suggestions", requireRoleAtLeast("MANAGER"), getInventoryReorderSuggestionsReportHandler);
reportRouter.get("/operations/actions", requireRoleAtLeast("MANAGER"), getActionCentreReportHandler);
reportRouter.get("/operations/exceptions", requireRoleAtLeast("MANAGER"), getOperationsExceptionsHandler);
reportRouter.get("/pricing/exceptions", requireRoleAtLeast("MANAGER"), getPricingExceptionsReportHandler);
reportRouter.get("/suppliers/performance", requireRoleAtLeast("MANAGER"), getSupplierPerformanceReportHandler);
reportRouter.get("/suppliers/cost-history", requireRoleAtLeast("MANAGER"), getSupplierCostHistoryReportHandler);
reportRouter.get("/customers/insights", requireRoleAtLeast("MANAGER"), getCustomerInsightsReportHandler);
reportRouter.get("/customers/reminders", requireRoleAtLeast("MANAGER"), getCustomerServiceRemindersReportHandler);
reportRouter.get("/reminder-candidates", requireRoleAtLeast("MANAGER"), getReminderCandidatesReportHandler);
reportRouter.post(
  "/reminder-candidates/:reminderCandidateId/review",
  requireRoleAtLeast("MANAGER"),
  markReminderCandidateReviewedHandler,
);
reportRouter.post(
  "/reminder-candidates/:reminderCandidateId/dismiss",
  requireRoleAtLeast("MANAGER"),
  dismissReminderCandidateHandler,
);
reportRouter.get("/workshop/capacity", requireRoleAtLeast("MANAGER"), getWorkshopCapacityReportHandler);
reportRouter.get("/workshop/analytics", requireRoleAtLeast("MANAGER"), getWorkshopAnalyticsReportHandler);
reportRouter.get("/workshop/warranty", requireRoleAtLeast("MANAGER"), getWorkshopWarrantyReportHandler);
