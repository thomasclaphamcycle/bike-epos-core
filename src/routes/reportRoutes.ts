import { Router } from "express";
import {
  getInventoryOnHandReportHandler,
  getInventoryOnHandReportCsvHandler,
  getInventoryValueReportHandler,
  getInventoryValueReportCsvHandler,
  getPaymentsReportCsvHandler,
  getSalesDailyReportHandler,
  getSalesDailyReportCsvHandler,
  getWorkshopDailyReportHandler,
  getWorkshopDailyReportCsvHandler,
} from "../controllers/reportController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const reportRouter = Router();

reportRouter.get("/sales/daily", requireRoleAtLeast("MANAGER"), getSalesDailyReportHandler);
reportRouter.get("/sales/daily.csv", requireRoleAtLeast("MANAGER"), getSalesDailyReportCsvHandler);
reportRouter.get("/workshop/daily", requireRoleAtLeast("MANAGER"), getWorkshopDailyReportHandler);
reportRouter.get(
  "/workshop/daily.csv",
  requireRoleAtLeast("MANAGER"),
  getWorkshopDailyReportCsvHandler,
);
reportRouter.get("/inventory/on-hand", requireRoleAtLeast("MANAGER"), getInventoryOnHandReportHandler);
reportRouter.get(
  "/inventory/on-hand.csv",
  requireRoleAtLeast("MANAGER"),
  getInventoryOnHandReportCsvHandler,
);
reportRouter.get("/inventory/value", requireRoleAtLeast("MANAGER"), getInventoryValueReportHandler);
reportRouter.get(
  "/inventory/value.csv",
  requireRoleAtLeast("MANAGER"),
  getInventoryValueReportCsvHandler,
);
reportRouter.get("/payments", requireRoleAtLeast("MANAGER"), getPaymentsReportCsvHandler);
