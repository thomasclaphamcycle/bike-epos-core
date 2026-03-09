import { Router } from "express";
import {
  createCustomerHandler,
  getCustomerHandler,
  listCustomersHandler,
  listCustomerSalesHandler,
  listCustomerWorkshopJobsHandler,
  searchCustomersHandler,
} from "../controllers/customerController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const customerRouter = Router();

customerRouter.post("/", requireRoleAtLeast("STAFF"), createCustomerHandler);
customerRouter.get("/", requireRoleAtLeast("STAFF"), listCustomersHandler);
customerRouter.get("/search", requireRoleAtLeast("STAFF"), searchCustomersHandler);
customerRouter.get("/:id/sales", requireRoleAtLeast("STAFF"), listCustomerSalesHandler);
customerRouter.get("/:id/workshop-jobs", requireRoleAtLeast("STAFF"), listCustomerWorkshopJobsHandler);
customerRouter.get("/:id", requireRoleAtLeast("STAFF"), getCustomerHandler);
