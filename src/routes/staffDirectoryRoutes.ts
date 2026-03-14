import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  listStaffDirectoryHandler,
  updateUserOperationalRoleHandler,
} from "../controllers/staffDirectoryController";

export const staffDirectoryRouter = Router();

staffDirectoryRouter.get("/", requireRoleAtLeast("MANAGER"), listStaffDirectoryHandler);
staffDirectoryRouter.patch(
  "/:id/operational-role",
  requireRoleAtLeast("MANAGER"),
  updateUserOperationalRoleHandler,
);
