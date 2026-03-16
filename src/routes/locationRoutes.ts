import { Router } from "express";
import {
  createLocationHandler,
  listLocationsHandler,
} from "../controllers/locationController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const locationRouter = Router();

locationRouter.get("/", requireRoleAtLeast("STAFF"), listLocationsHandler);
locationRouter.post("/", requireRoleAtLeast("ADMIN"), createLocationHandler);
