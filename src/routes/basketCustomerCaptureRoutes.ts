import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  createBasketCustomerCaptureSessionHandler,
  getCurrentBasketCustomerCaptureSessionHandler,
} from "../controllers/saleCustomerCaptureController";

export const basketCustomerCaptureRouter = Router({ mergeParams: true });

basketCustomerCaptureRouter.get(
  "/current",
  requireRoleAtLeast("STAFF"),
  getCurrentBasketCustomerCaptureSessionHandler,
);

basketCustomerCaptureRouter.post(
  "/",
  requireRoleAtLeast("STAFF"),
  createBasketCustomerCaptureSessionHandler,
);
