import { Router } from "express";
import {
  getWorkshopCreditsReportHandler,
  getWorkshopDepositsReportHandler,
  getWorkshopPaymentsReportHandler,
} from "../controllers/workshopReportController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const workshopReportRouter = Router();

workshopReportRouter.get("/payments", requireRoleAtLeast("MANAGER"), getWorkshopPaymentsReportHandler);
workshopReportRouter.get("/deposits", requireRoleAtLeast("MANAGER"), getWorkshopDepositsReportHandler);
workshopReportRouter.get("/credits", requireRoleAtLeast("MANAGER"), getWorkshopCreditsReportHandler);
