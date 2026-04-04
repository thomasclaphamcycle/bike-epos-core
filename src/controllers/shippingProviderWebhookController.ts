import type { Request, Response } from "express";
import { resolveShippingProviderForInboundSync } from "../services/shipping/providerConfigService";
import { reconcileProviderWebhookEvent } from "../services/shipping/providerSyncService";
import { HttpError } from "../utils/http";

const parseWebhookJsonBody = (body: unknown) => {
  if (!Buffer.isBuffer(body)) {
    throw new HttpError(
      400,
      "Shipping provider webhook body must be captured as raw JSON",
      "INVALID_SHIPPING_PROVIDER_WEBHOOK",
    );
  }

  const rawBody = body;
  if (rawBody.length === 0) {
    throw new HttpError(400, "Shipping provider webhook body cannot be empty", "INVALID_SHIPPING_PROVIDER_WEBHOOK");
  }

  const bodyText = rawBody.toString("utf8");
  try {
    return {
      rawBody,
      parsedBody: JSON.parse(bodyText) as unknown,
    };
  } catch {
    throw new HttpError(400, "Shipping provider webhook body must be valid JSON", "INVALID_SHIPPING_PROVIDER_WEBHOOK");
  }
};

export const receiveShippingProviderWebhookHandler = async (req: Request, res: Response) => {
  const { rawBody, parsedBody } = parseWebhookJsonBody(req.body);
  const resolvedProvider = await resolveShippingProviderForInboundSync(req.params.providerKey);
  if (!resolvedProvider.provider.parseWebhookEvent) {
    throw new HttpError(
      409,
      `${resolvedProvider.providerDisplayName} does not support inbound provider sync in CorePOS yet`,
      "SHIPPING_PROVIDER_WEBHOOK_UNSUPPORTED",
    );
  }

  const event = await resolvedProvider.provider.parseWebhookEvent(
    {
      headers: req.headers,
      method: req.method,
      path: req.originalUrl.split("?")[0] ?? req.originalUrl,
      rawBody,
      body: parsedBody,
    },
    {
      runtimeConfig: resolvedProvider.runtimeConfig,
    },
  );

  const result = await reconcileProviderWebhookEvent(resolvedProvider.providerKey, event);
  res.status(result.httpStatus).json({
    ok: true,
    providerKey: resolvedProvider.providerKey,
    duplicate: result.duplicate,
    applied: result.applied,
    shipmentId: result.shipmentId,
    event: result.receipt,
  });
};
