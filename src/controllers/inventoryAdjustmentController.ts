import { Request, Response } from "express";
import { getRequestStaffActorId } from "../middleware/staffRole";
import { resolveRequestLocation } from "../services/locationService";
import { recordAdjustment } from "../services/inventoryLedgerService";
import { HttpError } from "../utils/http";

const VALID_REASONS = new Set([
  "COUNT_CORRECTION",
  "DAMAGED",
  "SUPPLIER_ERROR",
  "THEFT",
  "OTHER",
]);

export const createInventoryAdjustmentHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    variantId?: unknown;
    locationId?: unknown;
    quantityDelta?: unknown;
    reason?: unknown;
    note?: unknown;
  };

  if (typeof body.variantId !== "string") {
    throw new HttpError(400, "variantId must be a string", "INVALID_INVENTORY_ADJUSTMENT");
  }
  if (body.locationId !== undefined && typeof body.locationId !== "string") {
    throw new HttpError(400, "locationId must be a string", "INVALID_INVENTORY_ADJUSTMENT");
  }
  if (typeof body.quantityDelta !== "number") {
    throw new HttpError(
      400,
      "quantityDelta must be a number",
      "INVALID_INVENTORY_ADJUSTMENT",
    );
  }
  if (typeof body.reason !== "string" || !VALID_REASONS.has(body.reason)) {
    throw new HttpError(
      400,
      "reason must be one of COUNT_CORRECTION, DAMAGED, SUPPLIER_ERROR, THEFT, OTHER",
      "INVALID_INVENTORY_ADJUSTMENT",
    );
  }
  if (body.note !== undefined && typeof body.note !== "string") {
    throw new HttpError(400, "note must be a string", "INVALID_INVENTORY_ADJUSTMENT");
  }

  const requestLocation =
    typeof body.locationId === "string" ? null : await resolveRequestLocation(req);

  const result = await recordAdjustment({
    variantId: body.variantId,
    locationId:
      typeof body.locationId === "string"
        ? body.locationId
        : (requestLocation?.stockLocationId ?? requestLocation?.id),
    quantityDelta: body.quantityDelta,
    reason: body.reason,
    note: body.note,
    createdByStaffId: getRequestStaffActorId(req),
  });

  res.status(201).json(result);
};
