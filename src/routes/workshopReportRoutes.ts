import { Router } from "express";
import {
  getWorkshopCreditsReportHandler,
  getWorkshopDepositsReportHandler,
  getWorkshopPaymentsReportHandler,
} from "../controllers/workshopReportController";

export const workshopReportRouter = Router();

workshopReportRouter.get("/payments", getWorkshopPaymentsReportHandler);
workshopReportRouter.get("/deposits", getWorkshopDepositsReportHandler);
workshopReportRouter.get("/credits", getWorkshopCreditsReportHandler);
