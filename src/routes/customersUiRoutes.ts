import { Router } from "express";
import {
  getCustomerProfilePageHandler,
  getCustomersPageHandler,
} from "../controllers/customersUiController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const customersUiRouter = Router();

customersUiRouter.get("/customers", requireRoleAtLeast("STAFF"), getCustomersPageHandler);
customersUiRouter.get("/customers/:id", requireRoleAtLeast("STAFF"), getCustomerProfilePageHandler);
