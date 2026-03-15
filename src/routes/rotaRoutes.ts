import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  bankHolidayStatusHandler,
  clearRotaAssignmentHandler,
  confirmRotaImportHandler,
  createRotaPeriodHandler,
  listRotaOverviewHandler,
  previewRotaImportHandler,
  saveRotaAssignmentHandler,
  syncBankHolidaysHandler,
} from "../controllers/rotaController";

export const rotaRouter = Router();

rotaRouter.get("/", requireRoleAtLeast("MANAGER"), listRotaOverviewHandler);
rotaRouter.get("/bank-holidays/status", requireRoleAtLeast("MANAGER"), bankHolidayStatusHandler);
rotaRouter.post("/bank-holidays/sync", requireRoleAtLeast("ADMIN"), syncBankHolidaysHandler);
rotaRouter.post("/periods", requireRoleAtLeast("MANAGER"), createRotaPeriodHandler);
rotaRouter.post("/assignments", requireRoleAtLeast("MANAGER"), saveRotaAssignmentHandler);
rotaRouter.delete("/assignments/:assignmentId", requireRoleAtLeast("MANAGER"), clearRotaAssignmentHandler);
rotaRouter.post("/import/preview", requireRoleAtLeast("ADMIN"), previewRotaImportHandler);
rotaRouter.post("/import/confirm", requireRoleAtLeast("ADMIN"), confirmRotaImportHandler);
