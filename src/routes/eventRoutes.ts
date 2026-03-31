import { Router } from "express";
import { getEventsHandler } from "../controllers/eventController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const eventRouter = Router();

eventRouter.get("/", requireRoleAtLeast("STAFF"), getEventsHandler);
