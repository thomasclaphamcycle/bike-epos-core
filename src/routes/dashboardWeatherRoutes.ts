import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import { dashboardWeatherHandler } from "../controllers/dashboardWeatherController";

export const dashboardWeatherRouter = Router();

dashboardWeatherRouter.get("/weather", requireRoleAtLeast("STAFF"), dashboardWeatherHandler);
