import { Router } from "express";
import {
  getPublicWorkshopConversationHandler,
  getPublicWorkshopEstimateQuoteHandler,
  getPublicWorkshopPortalHandler,
  postPublicWorkshopConversationReplyHandler,
  submitPublicWorkshopPortalDecisionHandler,
  submitPublicWorkshopEstimateQuoteDecisionHandler,
} from "../controllers/workshopController";

export const publicWorkshopQuoteRouter = Router();

publicWorkshopQuoteRouter.get("/workshop/:token", getPublicWorkshopPortalHandler);
publicWorkshopQuoteRouter.get("/workshop/:token/conversation", getPublicWorkshopConversationHandler);
publicWorkshopQuoteRouter.post("/workshop/:token/conversation/messages", postPublicWorkshopConversationReplyHandler);
publicWorkshopQuoteRouter.post("/workshop/:token/decision", submitPublicWorkshopPortalDecisionHandler);
publicWorkshopQuoteRouter.get("/workshop-quotes/:token", getPublicWorkshopEstimateQuoteHandler);
publicWorkshopQuoteRouter.post("/workshop-quotes/:token", submitPublicWorkshopEstimateQuoteDecisionHandler);
