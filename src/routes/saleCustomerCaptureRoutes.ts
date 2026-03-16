import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import { createSaleCustomerCaptureSessionHandler } from "../controllers/saleCustomerCaptureController";

export const saleCustomerCaptureRouter = Router({ mergeParams: true });

saleCustomerCaptureRouter.post(
  "/",
  requireRoleAtLeast("STAFF"),
  createSaleCustomerCaptureSessionHandler,
);
