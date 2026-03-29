import { CashMovementReason, CashMovementType, CashSessionStatus } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import {
  addPaidMovement,
  closeCashSession,
  getCurrentCashSession,
  listCashSessions,
  openCashSession,
  recordCashCount,
} from "./tillService";
import { listCashMovements } from "./cashService";

type OpenRegisterInput = {
  openingFloatPence?: number;
  businessDate?: string;
  openedByStaffId?: string;
};

type CloseRegisterInput = {
  countedAmountPence?: number;
  notes?: string;
  closedByStaffId?: string;
};

type ListRangeInput = {
  from?: string;
  to?: string;
};

type CreateManagementCashMovementInput = {
  type?: string;
  amountPence?: number;
  reason?: string;
  notes?: string;
  createdByStaffId?: string;
};

const RECEIPT_UPLOAD_TTL_MINUTES = 5;
const RECEIPT_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
const RECEIPT_UPLOAD_DIR = path.join(process.cwd(), "uploads", "cash-receipts");

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toPositiveIntOrThrow = (value: number | undefined, field: string, code: string) => {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    throw new HttpError(400, `${field} must be a positive integer`, code);
  }
  return value as number;
};

const toNonNegativeIntOrThrow = (value: number | undefined, field: string, code: string) => {
  if (!Number.isInteger(value) || (value ?? -1) < 0) {
    throw new HttpError(400, `${field} must be a non-negative integer`, code);
  }
  return value as number;
};

const parseManagementMovementTypeOrThrow = (value: string | undefined) => {
  const normalized = normalizeOptionalText(value)?.toUpperCase();
  if (normalized !== "CASH_IN" && normalized !== "CASH_OUT") {
    throw new HttpError(400, "type must be CASH_IN or CASH_OUT", "INVALID_CASH_MOVEMENT");
  }

  return {
    apiType: normalized as "CASH_IN" | "CASH_OUT",
    tillType: normalized === "CASH_IN" ? "PAID_IN" : "PAID_OUT",
  };
};

const parseCashMovementReasonOrThrow = (
  value: string | undefined,
): CashMovementReason | undefined => {
  const normalized = normalizeOptionalText(value)?.toUpperCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "BANK_DEPOSIT" ||
    normalized === "SAFE_DROP" ||
    normalized === "SUPPLIER_PAYMENT" ||
    normalized === "PETTY_EXPENSE" ||
    normalized === "OTHER"
  ) {
    return normalized as CashMovementReason;
  }

  throw new HttpError(
    400,
    "reason must be BANK_DEPOSIT, SAFE_DROP, SUPPLIER_PAYMENT, PETTY_EXPENSE, or OTHER",
    "INVALID_CASH_REASON",
  );
};

const requireOpenRegisterSession = async () => {
  const current = await getCurrentCashSession();
  if (!current.session) {
    throw new HttpError(
      409,
      "No open register session. Start the till before recording cash activity.",
      "REGISTER_SESSION_REQUIRED",
    );
  }
  return current;
};

const parseImageDataUrlOrThrow = (imageDataUrl: string) => {
  const match = imageDataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new HttpError(400, "imageDataUrl must be a PNG, JPEG, or WEBP data URL", "INVALID_RECEIPT_IMAGE");
  }

  const mimeType = match[1];
  const base64Payload = match[2];
  const buffer = Buffer.from(base64Payload, "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > RECEIPT_UPLOAD_MAX_BYTES) {
    throw new HttpError(400, "Receipt image must be between 1 byte and 8MB", "INVALID_RECEIPT_IMAGE");
  }

  const extension =
    mimeType === "image/png"
      ? "png"
      : mimeType === "image/webp"
        ? "webp"
        : "jpg";

  return { buffer, extension };
};

const buildReceiptPublicPath = (filename: string) => `/uploads/cash-receipts/${filename}`;

const removeReceiptFileIfExists = async (absolutePath: string) => {
  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
};

export const openRegisterSession = async (input: OpenRegisterInput) =>
  openCashSession(input);

export const getCurrentRegisterSession = async () => getCurrentCashSession();

export const getRegisterHistory = async (input: ListRangeInput = {}) =>
  listCashSessions(input);

export const closeCurrentRegisterBlind = async (input: CloseRegisterInput) => {
  const countedAmountPence = toNonNegativeIntOrThrow(
    input.countedAmountPence,
    "countedAmountPence",
    "INVALID_CASH_COUNT",
  );
  const current = await requireOpenRegisterSession();

  await recordCashCount(current.session.id, {
    countedCashPence: countedAmountPence,
    notes: normalizeOptionalText(input.notes),
    countedByStaffId: input.closedByStaffId,
  });

  return closeCashSession(current.session.id, input.closedByStaffId);
};

export const createManagementCashMovement = async (input: CreateManagementCashMovementInput) => {
  const parsedType = parseManagementMovementTypeOrThrow(input.type);
  const amountPence = toPositiveIntOrThrow(
    input.amountPence,
    "amountPence",
    "INVALID_CASH_MOVEMENT",
  );
  const reason = parseCashMovementReasonOrThrow(input.reason);
  const notes = normalizeOptionalText(input.notes);

  if (parsedType.apiType === "CASH_OUT" && !reason) {
    throw new HttpError(400, "reason is required for cash out", "CASH_REASON_REQUIRED");
  }
  if (reason === "OTHER" && !notes) {
    throw new HttpError(400, "notes are required when reason is OTHER", "CASH_NOTES_REQUIRED");
  }

  const current = await requireOpenRegisterSession();

  return addPaidMovement(current.session.id, {
    type: parsedType.tillType,
    amountPence,
    note: notes,
    reason,
    createdByStaffId: input.createdByStaffId,
  });
};

export const getManagementCashMovements = async (input: ListRangeInput = {}) =>
  listCashMovements(input);

export const createCashMovementReceiptToken = async (movementId: string) => {
  if (!isUuid(movementId)) {
    throw new HttpError(400, "Invalid cash movement id", "INVALID_CASH_MOVEMENT_ID");
  }

  const movement = await prisma.cashMovement.findUnique({
    where: { id: movementId },
    select: {
      id: true,
      type: true,
      reason: true,
      receiptImageUrl: true,
      session: {
        select: {
          status: true,
        },
      },
    },
  });

  if (!movement) {
    throw new HttpError(404, "Cash movement not found", "CASH_MOVEMENT_NOT_FOUND");
  }
  if (movement.session.status !== CashSessionStatus.OPEN) {
    throw new HttpError(409, "Receipt tokens can only be created for open sessions", "SESSION_CLOSED");
  }
  if (movement.type !== CashMovementType.PAID_OUT || movement.reason !== "PETTY_EXPENSE") {
    throw new HttpError(
      409,
      "Receipt upload tokens are only available for petty expense cash-out movements",
      "RECEIPT_TOKEN_NOT_ALLOWED",
    );
  }
  if (movement.receiptImageUrl) {
    throw new HttpError(409, "A receipt is already attached to this cash movement", "RECEIPT_ALREADY_ATTACHED");
  }

  const expiresAt = new Date(Date.now() + RECEIPT_UPLOAD_TTL_MINUTES * 60_000);
  const token = randomBytes(24).toString("base64url");

  await prisma.cashReceiptUploadToken.updateMany({
    where: {
      cashMovementId: movement.id,
      usedAt: null,
    },
    data: {
      expiresAt: new Date(),
    },
  });

  const created = await prisma.cashReceiptUploadToken.create({
    data: {
      token,
      cashMovementId: movement.id,
      expiresAt,
    },
    select: {
      token: true,
      expiresAt: true,
      cashMovementId: true,
    },
  });

  return {
    token: created.token,
    expiresAt: created.expiresAt,
    cashMovementId: created.cashMovementId,
    uploadApiPath: `/api/public/receipt-upload/${created.token}`,
    uploadPagePath: `/receipt-upload/${created.token}`,
  };
};

export const attachCashMovementReceiptByToken = async (tokenValue: string, imageDataUrl: string) => {
  const token = normalizeOptionalText(tokenValue);
  if (!token) {
    throw new HttpError(400, "Token is required", "INVALID_RECEIPT_TOKEN");
  }

  const tokenRecord = await prisma.cashReceiptUploadToken.findUnique({
    where: { token },
    include: {
      cashMovement: {
        select: {
          id: true,
          receiptImageUrl: true,
        },
      },
    },
  });

  if (!tokenRecord) {
    throw new HttpError(404, "Receipt upload token not found", "RECEIPT_TOKEN_NOT_FOUND");
  }
  if (tokenRecord.usedAt) {
    throw new HttpError(409, "Receipt upload token has already been used", "RECEIPT_TOKEN_USED");
  }
  if (tokenRecord.expiresAt.getTime() < Date.now()) {
    throw new HttpError(410, "Receipt upload token has expired", "RECEIPT_TOKEN_EXPIRED");
  }
  if (tokenRecord.cashMovement.receiptImageUrl) {
    throw new HttpError(409, "A receipt is already attached to this cash movement", "RECEIPT_ALREADY_ATTACHED");
  }

  const { buffer, extension } = parseImageDataUrlOrThrow(imageDataUrl);
  await fs.mkdir(RECEIPT_UPLOAD_DIR, { recursive: true });
  const filename = `${randomUUID()}.${extension}`;
  const absolutePath = path.join(RECEIPT_UPLOAD_DIR, filename);
  const publicPath = buildReceiptPublicPath(filename);
  await fs.writeFile(absolutePath, buffer);

  try {
    await prisma.$transaction(async (tx) => {
      const claimedToken = await tx.cashReceiptUploadToken.updateMany({
        where: {
          id: tokenRecord.id,
          usedAt: null,
          expiresAt: {
            gt: new Date(),
          },
        },
        data: {
          usedAt: new Date(),
        },
      });

      if (claimedToken.count !== 1) {
        throw new HttpError(409, "Receipt upload token has already been used", "RECEIPT_TOKEN_USED");
      }

      const attachedMovement = await tx.cashMovement.updateMany({
        where: {
          id: tokenRecord.cashMovementId,
          receiptImageUrl: null,
        },
        data: {
          receiptImageUrl: publicPath,
        },
      });

      if (attachedMovement.count !== 1) {
        throw new HttpError(409, "A receipt is already attached to this cash movement", "RECEIPT_ALREADY_ATTACHED");
      }
    });
  } catch (error) {
    try {
      await removeReceiptFileIfExists(absolutePath);
    } catch {
      // Best-effort cleanup; preserve the original upload failure.
    }
    throw error;
  }

  return {
    cashMovementId: tokenRecord.cashMovementId,
    receiptImageUrl: publicPath,
  };
};
