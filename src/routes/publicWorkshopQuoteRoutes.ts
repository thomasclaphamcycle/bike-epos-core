import { Router } from "express";
import {
  getPublicWorkshopEstimateQuoteHandler,
  getPublicWorkshopPortalHandler,
  submitPublicWorkshopPortalDecisionHandler,
  submitPublicWorkshopEstimateQuoteDecisionHandler,
} from "../controllers/workshopController";

export const publicWorkshopQuoteRouter = Router();

publicWorkshopQuoteRouter.get("/workshop/:token", getPublicWorkshopPortalHandler);
publicWorkshopQuoteRouter.post("/workshop/:token/decision", submitPublicWorkshopPortalDecisionHandler);
publicWorkshopQuoteRouter.get("/workshop-quotes/:token", getPublicWorkshopEstimateQuoteHandler);
publicWorkshopQuoteRouter.post("/workshop-quotes/:token", submitPublicWorkshopEstimateQuoteDecisionHandler);
