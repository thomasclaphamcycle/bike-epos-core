import { Router } from "express";
import {
  cancelWorkshopBookingByManageTokenHandler,
  createOnlineWorkshopBookingHandler,
  getPublicWorkshopBookingFormOptionsHandler,
  getWorkshopBookingByManageTokenHandler,
  payWorkshopBookingDepositByManageTokenHandler,
  updateWorkshopBookingByManageTokenHandler,
} from "../controllers/workshopController";

export const workshopBookingRouter = Router();

workshopBookingRouter.get("/public-form", getPublicWorkshopBookingFormOptionsHandler);
workshopBookingRouter.post("/", createOnlineWorkshopBookingHandler);
workshopBookingRouter.get("/manage/:token", getWorkshopBookingByManageTokenHandler);
workshopBookingRouter.patch("/manage/:token", updateWorkshopBookingByManageTokenHandler);
workshopBookingRouter.post(
  "/manage/:token/pay-deposit",
  payWorkshopBookingDepositByManageTokenHandler,
);
workshopBookingRouter.post(
  "/manage/:token/cancel",
  cancelWorkshopBookingByManageTokenHandler,
);
