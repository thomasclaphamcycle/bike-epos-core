import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  confirmRotaImportHandler,
  listRotaOverviewHandler,
  previewRotaImportHandler,
} from "../controllers/rotaController";

export const rotaRouter = Router();

rotaRouter.get("/", requireRoleAtLeast("MANAGER"), listRotaOverviewHandler);
rotaRouter.post("/import/preview", requireRoleAtLeast("ADMIN"), previewRotaImportHandler);
rotaRouter.post("/import/confirm", requireRoleAtLeast("ADMIN"), confirmRotaImportHandler);
