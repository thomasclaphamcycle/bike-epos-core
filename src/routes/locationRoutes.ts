import { Router } from "express";
import { listStockLocationsHandler } from "../controllers/locationController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const locationRouter = Router();

locationRouter.get("/", requireRoleAtLeast("STAFF"), listStockLocationsHandler);
