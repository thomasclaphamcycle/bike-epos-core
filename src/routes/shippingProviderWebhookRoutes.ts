import express, { Router } from "express";
import { receiveShippingProviderWebhookHandler } from "../controllers/shippingProviderWebhookController";

export const shippingProviderWebhookRouter = Router();

shippingProviderWebhookRouter.post(
  "/:providerKey/webhooks",
  express.raw({ type: ["application/json", "application/*+json"], limit: "1mb" }),
  receiveShippingProviderWebhookHandler,
);
