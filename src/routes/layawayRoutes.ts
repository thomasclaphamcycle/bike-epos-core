import { Router } from "express";
import {
  cancelLayawayHandler,
  completeLayawayHandler,
  getLayawayHandler,
  listLayawaysHandler,
} from "../controllers/layawayController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const layawayRouter = Router();

layawayRouter.get("/", requireRoleAtLeast("STAFF"), listLayawaysHandler);
layawayRouter.get("/:id", requireRoleAtLeast("STAFF"), getLayawayHandler);
layawayRouter.post("/:id/cancel", requireRoleAtLeast("MANAGER"), cancelLayawayHandler);
layawayRouter.post("/:id/complete", requireRoleAtLeast("STAFF"), completeLayawayHandler);
