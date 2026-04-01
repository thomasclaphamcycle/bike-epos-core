import { Router } from "express";
import {
  cancelWorkshopBookingByManageTokenHandler,
  createOnlineWorkshopBookingHandler,
  getPublicWorkshopBookingFormOptionsHandler,
  getWorkshopBookingByManageTokenHandler,
  payWorkshopBookingDepositByManageTokenHandler,
  updateWorkshopBookingByManageTokenHandler,
} from "../controllers/workshopController";
import { attachCustomerAccountIfPresent } from "../middleware/customerAccountAuth";

export const workshopBookingRouter = Router();

workshopBookingRouter.get("/public-form", getPublicWorkshopBookingFormOptionsHandler);
workshopBookingRouter.post("/", attachCustomerAccountIfPresent, createOnlineWorkshopBookingHandler);
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
