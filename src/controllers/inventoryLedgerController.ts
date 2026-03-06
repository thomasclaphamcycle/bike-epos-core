import { InventoryMovementType } from "@prisma/client";
import { Request, Response } from "express";
import {
  assertRoleAtLeast,
  getRequestStaffActorId,
} from "../middleware/staffRole";
import {
  getOnHand,
  listOnHand,
  listMovements,
  recordMovement,
} from "../services/inventoryLedgerService";
import { resolveRequestLocation } from "../services/locationService";
import { HttpError } from "../utils/http";

const INVENTORY_MOVEMENT_TYPES = new Set<InventoryMovementType>(
  Object.values(InventoryMovementType),
);

const parseMovementTypeOrThrow = (
  value: unknown,
  code: string,
): InventoryMovementType => {
  if (typeof value !== "string") {
    throw new HttpError(400, "type must be a string", code);
  }

  const normalized = value.trim().toUpperCase();
  if (!INVENTORY_MOVEMENT_TYPES.has(normalized as InventoryMovementType)) {
    throw new HttpError(
      400,
      "type must be one of PURCHASE, SALE, ADJUSTMENT, WORKSHOP_USE, RETURN",
      code,
    );
  }

  return normalized as InventoryMovementType;
};

export const createInventoryMovementHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    variantId?: string;
    type?: unknown;
    quantity?: unknown;
    unitCost?: unknown;
    referenceType?: unknown;
    referenceId?: unknown;
    note?: unknown;
  };

  if (body.variantId !== undefined && typeof body.variantId !== "string") {
    throw new HttpError(400, "variantId must be a string", "INVALID_INVENTORY_MOVEMENT");
  }
  if (body.quantity !== undefined && typeof body.quantity !== "number") {
    throw new HttpError(400, "quantity must be a number", "INVALID_INVENTORY_MOVEMENT");
  }
  if (
    body.unitCost !== undefined &&
    body.unitCost !== null &&
    typeof body.unitCost !== "number" &&
    typeof body.unitCost !== "string"
  ) {
    throw new HttpError(
      400,
      "unitCost must be a number, string, or null",
      "INVALID_INVENTORY_MOVEMENT",
    );
  }
  if (body.referenceType !== undefined && typeof body.referenceType !== "string") {
    throw new HttpError(400, "referenceType must be a string", "INVALID_INVENTORY_MOVEMENT");
  }
  if (body.referenceId !== undefined && typeof body.referenceId !== "string") {
    throw new HttpError(400, "referenceId must be a string", "INVALID_INVENTORY_MOVEMENT");
  }
  if (body.note !== undefined && typeof body.note !== "string") {
    throw new HttpError(400, "note must be a string", "INVALID_INVENTORY_MOVEMENT");
  }

  const type = parseMovementTypeOrThrow(body.type, "INVALID_INVENTORY_MOVEMENT");
  if (type === "ADJUSTMENT") {
    assertRoleAtLeast(req, "MANAGER");
  }

  const movementInput: {
    variantId?: string;
    locationId?: string;
    type: InventoryMovementType;
    quantity?: number;
    unitCost?: string | number | null;
    referenceType?: string;
    referenceId?: string;
    note?: string;
    createdByStaffId?: string;
  } = {
    type,
  };

  if (typeof body.variantId === "string") {
    movementInput.variantId = body.variantId;
  }
  if (typeof body.quantity === "number") {
    movementInput.quantity = body.quantity;
  }
  if (body.unitCost === null || typeof body.unitCost === "number" || typeof body.unitCost === "string") {
    movementInput.unitCost = body.unitCost;
  }
  if (typeof body.referenceType === "string") {
    movementInput.referenceType = body.referenceType;
  }
  if (typeof body.referenceId === "string") {
    movementInput.referenceId = body.referenceId;
  }
  if (typeof body.note === "string") {
    movementInput.note = body.note;
  }
  const staffActorId = getRequestStaffActorId(req);
  if (staffActorId) {
    movementInput.createdByStaffId = staffActorId;
  }
  const location = await resolveRequestLocation(req);
  movementInput.locationId = location.id;

  const movement = await recordMovement(movementInput);

  res.status(201).json(movement);
};

export const listInventoryMovementsHandler = async (req: Request, res: Response) => {
  const variantId = typeof req.query.variantId === "string" ? req.query.variantId : undefined;
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const typeRaw = typeof req.query.type === "string" ? req.query.type : undefined;

  const filters: {
    variantId?: string;
    locationId?: string;
    from?: string;
    to?: string;
    type?: InventoryMovementType;
  } = {};
  if (variantId) {
    filters.variantId = variantId;
  }
  if (from) {
    filters.from = from;
  }
  if (to) {
    filters.to = to;
  }
  if (typeRaw) {
    filters.type = parseMovementTypeOrThrow(typeRaw, "INVALID_INVENTORY_MOVEMENT_FILTER");
  }
  const location = await resolveRequestLocation(req);
  filters.locationId = location.id;

  const response = await listMovements(filters);

  res.json(response);
};

export const getInventoryOnHandHandler = async (req: Request, res: Response) => {
  const variantId = typeof req.query.variantId === "string" ? req.query.variantId : undefined;
  const location = await resolveRequestLocation(req);
  const response = await getOnHand(variantId, location.id);
  res.json(response);
};

const parseOptionalIntQuery = (value: unknown): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "take/skip must be an integer", "INVALID_ON_HAND_QUERY");
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new HttpError(400, "take/skip must be an integer", "INVALID_ON_HAND_QUERY");
  }
  return parsed;
};

export const listInventoryOnHandHandler = async (req: Request, res: Response) => {
  const q =
    typeof req.query.q === "string"
      ? req.query.q
      : typeof req.query.query === "string"
        ? req.query.query
        : undefined;
  const activeRaw = typeof req.query.active === "string" ? req.query.active : undefined;
  let isActive: boolean | undefined;
  if (activeRaw !== undefined) {
    if (activeRaw === "1") {
      isActive = true;
    } else if (activeRaw === "0") {
      isActive = false;
    } else {
      throw new HttpError(400, "active must be 1 or 0", "INVALID_ON_HAND_QUERY");
    }
  }

  const take = parseOptionalIntQuery(req.query.take);
  const skip = parseOptionalIntQuery(req.query.skip);
  const location = await resolveRequestLocation(req);
  const result = await listOnHand({ q, isActive, take, skip, locationId: location.id });
  res.json(result);
};
