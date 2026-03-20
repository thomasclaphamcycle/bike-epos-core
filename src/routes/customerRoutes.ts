import { Router } from "express";
import {
  createCustomerBikeHandler,
  createCustomerHandler,
  getCustomerHandler,
  getCustomerTimelineHandler,
  listCustomersHandler,
  listCustomerBikesHandler,
  listCustomerSalesHandler,
  listCustomerWorkshopJobsHandler,
  searchCustomersHandler,
} from "../controllers/customerController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const customerRouter = Router();

customerRouter.post("/", requireRoleAtLeast("STAFF"), createCustomerHandler);
customerRouter.get("/", requireRoleAtLeast("STAFF"), listCustomersHandler);
customerRouter.get("/search", requireRoleAtLeast("STAFF"), searchCustomersHandler);
customerRouter.get("/:id/bikes", requireRoleAtLeast("STAFF"), listCustomerBikesHandler);
customerRouter.post("/:id/bikes", requireRoleAtLeast("STAFF"), createCustomerBikeHandler);
customerRouter.get("/:id/sales", requireRoleAtLeast("STAFF"), listCustomerSalesHandler);
customerRouter.get("/:id/workshop-jobs", requireRoleAtLeast("STAFF"), listCustomerWorkshopJobsHandler);
customerRouter.get("/:id/timeline", requireRoleAtLeast("STAFF"), getCustomerTimelineHandler);
customerRouter.get("/:id", requireRoleAtLeast("STAFF"), getCustomerHandler);
