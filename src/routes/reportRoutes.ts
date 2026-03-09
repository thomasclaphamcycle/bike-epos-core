import { Router } from "express";
import {
  getInventoryOnHandReportHandler,
  getInventoryOnHandReportCsvHandler,
  getInventoryVelocityReportHandler,
  getInventoryValueReportHandler,
  getInventoryValueReportCsvHandler,
  getPaymentsReportCsvHandler,
  getProductSalesReportHandler,
  getSalesDailyReportHandler,
  getSalesDailyReportCsvHandler,
  getSupplierPerformanceReportHandler,
  getWorkshopDailyReportHandler,
  getWorkshopDailyReportCsvHandler,
} from "../controllers/reportController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const reportRouter = Router();

reportRouter.get("/sales/daily", getSalesDailyReportHandler);
reportRouter.get("/sales/daily.csv", requireRoleAtLeast("MANAGER"), getSalesDailyReportCsvHandler);
reportRouter.get("/workshop/daily", getWorkshopDailyReportHandler);
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
reportRouter.get(
  "/inventory/value.csv",
  requireRoleAtLeast("MANAGER"),
  getInventoryValueReportCsvHandler,
);
reportRouter.get("/payments", requireRoleAtLeast("MANAGER"), getPaymentsReportCsvHandler);
reportRouter.get("/sales/products", requireRoleAtLeast("MANAGER"), getProductSalesReportHandler);
reportRouter.get("/inventory/velocity", requireRoleAtLeast("MANAGER"), getInventoryVelocityReportHandler);
reportRouter.get("/suppliers/performance", requireRoleAtLeast("MANAGER"), getSupplierPerformanceReportHandler);
