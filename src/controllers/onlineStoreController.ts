import { Request, Response } from "express";
import { getRequestAuditActor } from "../middleware/staffRole";
import {
  bulkCreateShipmentLabels,
  bulkDispatchShipments,
  bulkPrintShipmentLabels,
  cancelShipment,
  createOnlineStoreOrder,
  createShipmentLabelForOrder,
  dispatchShipment,
  getOnlineStoreOrderDetail,
  getShipmentLabelPayload,
  lookupDispatchScan,
  listOnlineStoreOrders,
  prepareShipmentLabelPrint,
  printShipmentLabelViaAgent,
  refreshShipmentProviderState,
  regenerateShipmentLabel,
  recordShipmentPrinted,
  setWebOrderPackedState,
  type BulkCreateShipmentsInput,
type BulkDispatchShipmentsInput,
  type BulkPrintShipmentsInput,
  type CreateWebOrderInput,
  type CreateShipmentLabelInput,
  type DispatchScanLookupResponse,
  type SetWebOrderPackedInput,
} from "../services/orderService";
import { HttpError } from "../utils/http";
import { parseOptionalIntegerQuery } from "../utils/requestParsing";

const WEB_ORDER_STATUSES = new Set(["READY_FOR_DISPATCH", "DISPATCHED", "CANCELLED"]);
const FULFILLMENT_METHODS = new Set(["SHIPPING", "CLICK_AND_COLLECT"]);

const assertOptionalString = (value: unknown, field: string) => {
  if (value !== undefined && typeof value !== "string") {
    throw new HttpError(400, `${field} must be a string`, "INVALID_WEB_ORDER");
  }
};

const assertOptionalInteger = (value: unknown, field: string) => {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new HttpError(400, `${field} must be a non-negative integer`, "INVALID_WEB_ORDER");
  }
};

const assertOptionalPositiveInteger = (value: unknown, field: string) => {
  if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
    throw new HttpError(400, `${field} must be a positive integer`, "INVALID_WEB_ORDER");
  }
};

const parseStatusQuery = (value: unknown) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "status must be a string", "INVALID_FILTER");
  }

  const normalized = value.trim().toUpperCase();
  if (!WEB_ORDER_STATUSES.has(normalized)) {
    throw new HttpError(400, "status must be READY_FOR_DISPATCH, DISPATCHED, or CANCELLED", "INVALID_FILTER");
  }

  return normalized as "READY_FOR_DISPATCH" | "DISPATCHED" | "CANCELLED";
};

const parsePackedQuery = (value: unknown) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "packed must be true or false", "INVALID_FILTER");
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  throw new HttpError(400, "packed must be true or false", "INVALID_FILTER");
};

const toCreateWebOrderInput = (body: unknown): CreateWebOrderInput => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "web order body must be an object", "INVALID_WEB_ORDER");
  }

  const record = body as Record<string, unknown>;
  assertOptionalString(record.orderNumber, "orderNumber");
  assertOptionalString(record.sourceChannel, "sourceChannel");
  assertOptionalString(record.externalOrderRef, "externalOrderRef");
  assertOptionalString(record.customerId, "customerId");
  assertOptionalString(record.customerName, "customerName");
  assertOptionalString(record.customerEmail, "customerEmail");
  assertOptionalString(record.customerPhone, "customerPhone");
  assertOptionalString(record.deliveryInstructions, "deliveryInstructions");
  assertOptionalString(record.shippingRecipientName, "shippingRecipientName");
  assertOptionalString(record.shippingAddressLine1, "shippingAddressLine1");
  assertOptionalString(record.shippingAddressLine2, "shippingAddressLine2");
  assertOptionalString(record.shippingCity, "shippingCity");
  assertOptionalString(record.shippingRegion, "shippingRegion");
  assertOptionalString(record.shippingPostcode, "shippingPostcode");
  assertOptionalString(record.shippingCountry, "shippingCountry");
  assertOptionalString(record.placedAt, "placedAt");
  assertOptionalInteger(record.shippingPricePence, "shippingPricePence");

  if (record.fulfillmentMethod !== undefined) {
    if (typeof record.fulfillmentMethod !== "string") {
      throw new HttpError(400, "fulfillmentMethod must be a string", "INVALID_WEB_ORDER");
    }
    const normalized = record.fulfillmentMethod.trim().toUpperCase();
    if (!FULFILLMENT_METHODS.has(normalized)) {
      throw new HttpError(400, "fulfillmentMethod must be SHIPPING or CLICK_AND_COLLECT", "INVALID_WEB_ORDER");
    }
  }

  if (!Array.isArray(record.items)) {
    throw new HttpError(400, "items must be an array", "INVALID_WEB_ORDER");
  }

  const items = record.items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, `items[${index}] must be an object`, "INVALID_WEB_ORDER");
    }

    const line = item as Record<string, unknown>;
    assertOptionalString(line.variantId, `items[${index}].variantId`);
    assertOptionalString(line.sku, `items[${index}].sku`);
    assertOptionalString(line.productName, `items[${index}].productName`);
    assertOptionalString(line.variantName, `items[${index}].variantName`);
    assertOptionalPositiveInteger(line.quantity, `items[${index}].quantity`);
    assertOptionalInteger(line.unitPricePence, `items[${index}].unitPricePence`);

    return {
      variantId: line.variantId as string | undefined,
      sku: line.sku as string | undefined,
      productName: line.productName as string | undefined,
      variantName: line.variantName as string | undefined,
      quantity: line.quantity as number | undefined,
      unitPricePence: line.unitPricePence as number | undefined,
    };
  });

  return {
    orderNumber: record.orderNumber as string | undefined,
    sourceChannel: record.sourceChannel as string | undefined,
    externalOrderRef: record.externalOrderRef as string | undefined,
    fulfillmentMethod:
      typeof record.fulfillmentMethod === "string"
        ? (record.fulfillmentMethod.trim().toUpperCase() as CreateWebOrderInput["fulfillmentMethod"])
        : undefined,
    customerId: record.customerId as string | undefined,
    customerName: record.customerName as string | undefined,
    customerEmail: record.customerEmail as string | undefined,
    customerPhone: record.customerPhone as string | undefined,
    deliveryInstructions: record.deliveryInstructions as string | undefined,
    shippingRecipientName: record.shippingRecipientName as string | undefined,
    shippingAddressLine1: record.shippingAddressLine1 as string | undefined,
    shippingAddressLine2: record.shippingAddressLine2 as string | undefined,
    shippingCity: record.shippingCity as string | undefined,
    shippingRegion: record.shippingRegion as string | undefined,
    shippingPostcode: record.shippingPostcode as string | undefined,
    shippingCountry: record.shippingCountry as string | undefined,
    shippingPricePence: record.shippingPricePence as number | undefined,
    placedAt: record.placedAt as string | undefined,
    items,
  };
};

const toCreateShipmentInput = (body: unknown): CreateShipmentLabelInput => {
  if (body === undefined) {
    return {};
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "shipment label body must be an object", "INVALID_WEB_ORDER_SHIPMENT");
  }

  const record = body as Record<string, unknown>;
  assertOptionalString(record.providerKey, "providerKey");
  assertOptionalString(record.serviceCode, "serviceCode");
  assertOptionalString(record.serviceName, "serviceName");

  return {
    providerKey: record.providerKey as string | undefined,
    serviceCode: record.serviceCode as string | undefined,
    serviceName: record.serviceName as string | undefined,
  };
};

const toPrintPreparationInput = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "prepare print body must be an object", "INVALID_WEB_ORDER_SHIPMENT");
  }

  const record = body as Record<string, unknown>;
  assertOptionalString(record.printerId, "printerId");
  assertOptionalString(record.printerKey, "printerKey");
  if (record.copies !== undefined && (!Number.isInteger(record.copies) || Number(record.copies) <= 0)) {
    throw new HttpError(400, "copies must be a positive integer", "INVALID_WEB_ORDER_SHIPMENT");
  }

  return {
    printerId: record.printerId as string | undefined,
    printerKey: record.printerKey as string | undefined,
    copies: record.copies as number | undefined,
  };
};

const toSetPackedInput = (body: unknown): SetWebOrderPackedInput => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "packed state body must be an object", "INVALID_WEB_ORDER");
  }

  const record = body as Record<string, unknown>;
  if (typeof record.packed !== "boolean") {
    throw new HttpError(400, "packed must be a boolean", "INVALID_WEB_ORDER");
  }

  return {
    packed: record.packed,
  };
};

const toBulkCreateShipmentsInput = (body: unknown): BulkCreateShipmentsInput => {
  const shipmentInput = toCreateShipmentInput(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "bulk shipment body must be an object", "INVALID_WEB_ORDER");
  }

  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.orderIds) || record.orderIds.some((orderId) => typeof orderId !== "string")) {
    throw new HttpError(400, "orderIds must be an array of UUID strings", "INVALID_WEB_ORDER");
  }

  return {
    ...shipmentInput,
    orderIds: record.orderIds as string[],
  };
};

const toBulkPrintShipmentsInput = (body: unknown): BulkPrintShipmentsInput => {
  const printInput = toPrintPreparationInput(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "bulk print body must be an object", "INVALID_WEB_ORDER");
  }

  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.orderIds) || record.orderIds.some((orderId) => typeof orderId !== "string")) {
    throw new HttpError(400, "orderIds must be an array of UUID strings", "INVALID_WEB_ORDER");
  }

  return {
    ...printInput,
    orderIds: record.orderIds as string[],
  };
};

const toBulkDispatchShipmentsInput = (body: unknown): BulkDispatchShipmentsInput => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "bulk dispatch body must be an object", "INVALID_WEB_ORDER");
  }

  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.orderIds) || record.orderIds.some((orderId) => typeof orderId !== "string")) {
    throw new HttpError(400, "orderIds must be an array of UUID strings", "INVALID_WEB_ORDER");
  }

  return {
    orderIds: record.orderIds as string[],
  };
};

const toDispatchScanInput = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "dispatch scan body must be an object", "INVALID_WEB_ORDER");
  }

  const record = body as Record<string, unknown>;
  if (typeof record.value !== "string") {
    throw new HttpError(400, "value must be a string", "INVALID_WEB_ORDER");
  }

  return {
    value: record.value,
  };
};

export const listOnlineStoreOrdersHandler = async (req: Request, res: Response) => {
  const payload = await listOnlineStoreOrders({
    q: typeof req.query.q === "string" ? req.query.q : undefined,
    status: parseStatusQuery(req.query.status),
    packed: parsePackedQuery(req.query.packed),
    take: parseOptionalIntegerQuery(req.query.take, {
      code: "INVALID_FILTER",
      message: "take must be an integer between 1 and 200",
      min: 1,
      max: 200,
    }),
    skip: parseOptionalIntegerQuery(req.query.skip, {
      code: "INVALID_FILTER",
      message: "skip must be a non-negative integer",
      min: 0,
    }),
  });

  res.json(payload);
};

export const createOnlineStoreOrderHandler = async (req: Request, res: Response) => {
  const result = await createOnlineStoreOrder(toCreateWebOrderInput(req.body), getRequestAuditActor(req));
  res.status(201).json(result);
};

export const setOnlineStoreOrderPackedStateHandler = async (req: Request, res: Response) => {
  const result = await setWebOrderPackedState(req.params.id, toSetPackedInput(req.body), getRequestAuditActor(req));
  res.json(result);
};

export const getOnlineStoreOrderDetailHandler = async (req: Request, res: Response) => {
  const payload = await getOnlineStoreOrderDetail(req.params.id);
  res.json(payload);
};

export const getOnlineStoreOrderShipmentHandler = async (req: Request, res: Response) => {
  const payload = await getOnlineStoreOrderDetail(req.params.id);
  res.json({
    orderId: payload.order.id,
    orderNumber: payload.order.orderNumber,
    shipment: payload.order.shipments[0] ?? null,
  });
};

export const createShipmentLabelHandler = async (req: Request, res: Response) => {
  const result = await createShipmentLabelForOrder(
    req.params.id,
    toCreateShipmentInput(req.body),
    getRequestAuditActor(req),
  );
  res.status(201).json(result);
};

export const bulkCreateShipmentLabelsHandler = async (req: Request, res: Response) => {
  const result = await bulkCreateShipmentLabels(toBulkCreateShipmentsInput(req.body), getRequestAuditActor(req));
  res.json(result);
};

export const bulkPrintShipmentLabelsHandler = async (req: Request, res: Response) => {
  const result = await bulkPrintShipmentLabels(toBulkPrintShipmentsInput(req.body), getRequestAuditActor(req));
  res.json(result);
};

export const bulkDispatchShipmentsHandler = async (req: Request, res: Response) => {
  const result = await bulkDispatchShipments(toBulkDispatchShipmentsInput(req.body), getRequestAuditActor(req));
  res.json(result);
};

export const lookupDispatchScanHandler = async (req: Request, res: Response<DispatchScanLookupResponse>) => {
  const payload = await lookupDispatchScan(toDispatchScanInput(req.body).value);
  res.json(payload);
};

export const getShipmentLabelPayloadHandler = async (req: Request, res: Response) => {
  const payload = await getShipmentLabelPayload(req.params.shipmentId);
  res.json(payload);
};

export const getShipmentLabelContentHandler = async (req: Request, res: Response) => {
  const payload = await getShipmentLabelPayload(req.params.shipmentId);
  res.type("text/plain; charset=utf-8");
  res.setHeader("X-CorePOS-Label-Format", payload.document.format);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${payload.document.fileName.replace(/"/g, "")}"`,
  );
  res.send(payload.document.content);
};

export const prepareShipmentLabelPrintHandler = async (req: Request, res: Response) => {
  const result = await prepareShipmentLabelPrint(
    req.params.shipmentId,
    toPrintPreparationInput(req.body),
    getRequestAuditActor(req),
  );

  res.json(result);
};

export const printShipmentLabelViaAgentHandler = async (req: Request, res: Response) => {
  const result = await printShipmentLabelViaAgent(
    req.params.shipmentId,
    toPrintPreparationInput(req.body),
    getRequestAuditActor(req),
  );
  res.json(result);
};

export const recordShipmentPrintedHandler = async (req: Request, res: Response) => {
  const result = await recordShipmentPrinted(req.params.shipmentId, getRequestAuditActor(req));
  res.json(result);
};

export const dispatchShipmentHandler = async (req: Request, res: Response) => {
  const result = await dispatchShipment(req.params.shipmentId, getRequestAuditActor(req));
  res.json(result);
};

export const refreshShipmentProviderStateHandler = async (req: Request, res: Response) => {
  const result = await refreshShipmentProviderState(req.params.shipmentId, getRequestAuditActor(req));
  res.json(result);
};

export const cancelShipmentHandler = async (req: Request, res: Response) => {
  const result = await cancelShipment(req.params.shipmentId, getRequestAuditActor(req));
  res.json(result);
};

export const regenerateShipmentLabelHandler = async (req: Request, res: Response) => {
  const result = await regenerateShipmentLabel(req.params.shipmentId, getRequestAuditActor(req));
  res.status(201).json(result);
};
