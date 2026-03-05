import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  getAdminAuditPageHandler,
  getAdminPageHandler,
} from "../controllers/adminUiController";

export const adminUiRouter = Router();

adminUiRouter.get("/admin", requireRoleAtLeast("ADMIN"), getAdminPageHandler);
adminUiRouter.get("/admin/audit", requireRoleAtLeast("ADMIN"), getAdminAuditPageHandler);
