import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  approveHolidayRequestHandler,
  cancelHolidayRequestHandler,
  listHolidayRequestsHandler,
  rejectHolidayRequestHandler,
  submitHolidayRequestHandler,
} from "../controllers/holidayRequestController";

export const holidayRequestRouter = Router();

holidayRequestRouter.get("/", requireRoleAtLeast("STAFF"), listHolidayRequestsHandler);
holidayRequestRouter.post("/", requireRoleAtLeast("STAFF"), submitHolidayRequestHandler);
holidayRequestRouter.post("/:id/approve", requireRoleAtLeast("MANAGER"), approveHolidayRequestHandler);
holidayRequestRouter.post("/:id/reject", requireRoleAtLeast("MANAGER"), rejectHolidayRequestHandler);
holidayRequestRouter.post("/:id/cancel", requireRoleAtLeast("STAFF"), cancelHolidayRequestHandler);
