import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  clearRotaAssignmentHandler,
  confirmRotaImportHandler,
  listRotaOverviewHandler,
  previewRotaImportHandler,
  saveRotaAssignmentHandler,
} from "../controllers/rotaController";

export const rotaRouter = Router();

rotaRouter.get("/", requireRoleAtLeast("MANAGER"), listRotaOverviewHandler);
rotaRouter.post("/assignments", requireRoleAtLeast("MANAGER"), saveRotaAssignmentHandler);
rotaRouter.delete("/assignments/:assignmentId", requireRoleAtLeast("MANAGER"), clearRotaAssignmentHandler);
rotaRouter.post("/import/preview", requireRoleAtLeast("ADMIN"), previewRotaImportHandler);
rotaRouter.post("/import/confirm", requireRoleAtLeast("ADMIN"), confirmRotaImportHandler);
