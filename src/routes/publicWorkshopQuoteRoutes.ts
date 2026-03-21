import { Router } from "express";
import {
  getPublicWorkshopEstimateQuoteHandler,
  submitPublicWorkshopEstimateQuoteDecisionHandler,
} from "../controllers/workshopController";

export const publicWorkshopQuoteRouter = Router();

publicWorkshopQuoteRouter.get("/workshop-quotes/:token", getPublicWorkshopEstimateQuoteHandler);
publicWorkshopQuoteRouter.post("/workshop-quotes/:token", submitPublicWorkshopEstimateQuoteDecisionHandler);
