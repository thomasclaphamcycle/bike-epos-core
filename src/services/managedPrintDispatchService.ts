import { type Prisma } from "@prisma/client";
import {
  validateManagedPrintQueuePayload,
  type ManagedPrintQueuePayload,
  type ManagedPrintWorkflowType,
} from "../../shared/managedPrintJobContract";
import { deliverBikeTagPrintRequestToAgent } from "./bikeTagPrintAgentDeliveryService";
import { deliverProductLabelPrintRequestToAgent } from "./productLabelPrintAgentDeliveryService";
import { deliverReceiptPrintRequestToAgent } from "./receiptPrintAgentDeliveryService";
import { deliverShipmentPrintRequestToAgent } from "./shipping/printAgentDeliveryService";

export type ManagedPrintDispatchResult = {
  externalJobId: string | null;
  printerTarget: string | null;
  simulated: boolean | null;
  outputPath: string | null;
  metadata: Prisma.JsonObject;
};

const toDispatchResult = (
  workflowType: ManagedPrintWorkflowType,
  job: {
    jobId: string;
    printerTarget: string;
    simulated: boolean;
    outputPath?: string | null;
    copies?: number;
    transportMode?: string;
  },
): ManagedPrintDispatchResult => ({
  externalJobId: job.jobId,
  printerTarget: job.printerTarget,
  simulated: job.simulated,
  outputPath: job.outputPath ?? null,
  metadata: {
    workflowType,
    externalJobId: job.jobId,
    printerTarget: job.printerTarget,
    simulated: job.simulated,
    outputPath: job.outputPath ?? null,
    copies: job.copies ?? null,
    transportMode: job.transportMode ?? null,
  },
});

export const dispatchManagedPrintPayload = async (
  payloadInput: unknown,
): Promise<ManagedPrintDispatchResult> => {
  const payload = validateManagedPrintQueuePayload(payloadInput);

  switch (payload.workflowType) {
    case "RECEIPT_PRINT": {
      const response = await deliverReceiptPrintRequestToAgent(payload.printRequest);
      return toDispatchResult(payload.workflowType, response.job);
    }
    case "SHIPMENT_LABEL_PRINT": {
      const response = await deliverShipmentPrintRequestToAgent(payload.printRequest);
      return toDispatchResult(payload.workflowType, response.job);
    }
    case "PRODUCT_LABEL_PRINT": {
      const response = await deliverProductLabelPrintRequestToAgent(payload.printRequest);
      return toDispatchResult(payload.workflowType, response.job);
    }
    case "BIKE_TAG_PRINT": {
      const response = await deliverBikeTagPrintRequestToAgent(payload.printRequest);
      return toDispatchResult(payload.workflowType, response.job);
    }
  }
};

export const buildManagedPrintQueuePayload = (payload: ManagedPrintQueuePayload): ManagedPrintQueuePayload => (
  validateManagedPrintQueuePayload(payload)
);
