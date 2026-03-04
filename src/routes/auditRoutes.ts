import { Router } from "express";
import { getAuditEventsHandler } from "../controllers/auditController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const auditRouter = Router();

auditRouter.get("/", requireRoleAtLeast("MANAGER"), getAuditEventsHandler);
