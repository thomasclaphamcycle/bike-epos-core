import { Router } from "express";
import {
  createCustomerHandler,
  getCustomerHandler,
  listCustomersHandler,
  patchCustomerHandler,
  searchCustomersHandler,
} from "../controllers/customerController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const customerRouter = Router();

customerRouter.post("/", requireRoleAtLeast("STAFF"), createCustomerHandler);
customerRouter.get("/", requireRoleAtLeast("STAFF"), listCustomersHandler);
customerRouter.get("/search", requireRoleAtLeast("STAFF"), searchCustomersHandler);
customerRouter.get("/:id", requireRoleAtLeast("STAFF"), getCustomerHandler);
customerRouter.patch("/:id", requireRoleAtLeast("STAFF"), patchCustomerHandler);
