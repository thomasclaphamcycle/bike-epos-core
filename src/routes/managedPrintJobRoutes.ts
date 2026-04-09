import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  getManagedPrintJobHandler,
  listManagedPrintJobsHandler,
  retryManagedPrintJobHandler,
} from "../controllers/managedPrintJobController";

export const managedPrintJobRouter = Router();

managedPrintJobRouter.get("/", requireRoleAtLeast("MANAGER"), listManagedPrintJobsHandler);
managedPrintJobRouter.get("/:jobId", requireRoleAtLeast("STAFF"), getManagedPrintJobHandler);
managedPrintJobRouter.post("/:jobId/retry", requireRoleAtLeast("MANAGER"), retryManagedPrintJobHandler);
