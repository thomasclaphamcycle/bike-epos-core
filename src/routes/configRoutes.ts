import { Router } from "express";
import { getConfigHandler } from "../controllers/configController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const configRouter = Router();

configRouter.get("/", requireRoleAtLeast("STAFF"), getConfigHandler);
