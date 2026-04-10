import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  createSaleCustomerCaptureSessionHandler,
  getCurrentSaleCustomerCaptureSessionHandler,
} from "../controllers/saleCustomerCaptureController";

export const saleCustomerCaptureRouter = Router({ mergeParams: true });

saleCustomerCaptureRouter.get(
  "/current",
  requireRoleAtLeast("STAFF"),
  getCurrentSaleCustomerCaptureSessionHandler,
);
saleCustomerCaptureRouter.post(
  "/",
  requireRoleAtLeast("STAFF"),
  createSaleCustomerCaptureSessionHandler,
);
