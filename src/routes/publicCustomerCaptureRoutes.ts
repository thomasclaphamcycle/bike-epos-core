import { Router } from "express";
import {
  getPublicCustomerCaptureStationEntryHandler,
  previewPublicSaleCustomerCaptureMatchHandler,
  getPublicSaleCustomerCaptureSessionHandler,
  submitPublicSaleCustomerCaptureHandler,
} from "../controllers/saleCustomerCaptureController";

export const publicCustomerCaptureRouter = Router();

publicCustomerCaptureRouter.get(
  "/customer-capture/entry/:station",
  getPublicCustomerCaptureStationEntryHandler,
);
publicCustomerCaptureRouter.get(
  "/customer-capture/:token",
  getPublicSaleCustomerCaptureSessionHandler,
);
publicCustomerCaptureRouter.post(
  "/customer-capture/:token/preview",
  previewPublicSaleCustomerCaptureMatchHandler,
);
publicCustomerCaptureRouter.post(
  "/customer-capture/:token",
  submitPublicSaleCustomerCaptureHandler,
);
