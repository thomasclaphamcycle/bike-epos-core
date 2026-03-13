import { Router } from "express";
import {
  cancelHireBookingHandler,
  checkoutHireBookingHandler,
  createHireAssetHandler,
  createHireBookingHandler,
  listHireAssetsHandler,
  listHireBookingsHandler,
  returnHireBookingHandler,
} from "../controllers/bikeHireController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const bikeHireRouter = Router();

bikeHireRouter.get("/assets", requireRoleAtLeast("STAFF"), listHireAssetsHandler);
bikeHireRouter.post("/assets", requireRoleAtLeast("MANAGER"), createHireAssetHandler);
bikeHireRouter.get("/bookings", requireRoleAtLeast("STAFF"), listHireBookingsHandler);
bikeHireRouter.post("/bookings", requireRoleAtLeast("STAFF"), createHireBookingHandler);
bikeHireRouter.post("/bookings/:id/checkout", requireRoleAtLeast("STAFF"), checkoutHireBookingHandler);
bikeHireRouter.post("/bookings/:id/return", requireRoleAtLeast("STAFF"), returnHireBookingHandler);
bikeHireRouter.post("/bookings/:id/cancel", requireRoleAtLeast("STAFF"), cancelHireBookingHandler);
