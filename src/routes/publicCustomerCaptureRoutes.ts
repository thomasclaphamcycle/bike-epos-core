import { Router } from "express";
import {
  getPublicSaleCustomerCaptureSessionHandler,
  submitPublicSaleCustomerCaptureHandler,
} from "../controllers/saleCustomerCaptureController";

export const publicCustomerCaptureRouter = Router();

publicCustomerCaptureRouter.get(
  "/customer-capture/:token",
  getPublicSaleCustomerCaptureSessionHandler,
);
publicCustomerCaptureRouter.post(
  "/customer-capture/:token",
  submitPublicSaleCustomerCaptureHandler,
);
