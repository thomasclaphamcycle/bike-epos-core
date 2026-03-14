import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import { dashboardWeatherHandler } from "../controllers/dashboardWeatherController";
import { dashboardStaffTodayHandler } from "../controllers/dashboardStaffController";

export const dashboardWeatherRouter = Router();

dashboardWeatherRouter.get("/weather", requireRoleAtLeast("STAFF"), dashboardWeatherHandler);
dashboardWeatherRouter.get("/staff-today", requireRoleAtLeast("STAFF"), dashboardStaffTodayHandler);
