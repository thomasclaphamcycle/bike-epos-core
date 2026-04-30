import { Request, Response } from "express";
import {
  emailSaleReceiptById,
  getReceiptByNumber,
  getSaleReceiptById,
  issueReceipt,
} from "../services/receiptService";
import { getRequestAuditActor, getRequestStaffActorId } from "../middleware/staffRole";
import { HttpError } from "../utils/http";
import {
  prepareSaleReceiptPrint,
  queueSaleReceiptPrint,
} from "../services/receiptPrintService";

const toReceiptPrintInput = (body: unknown) => {
  if (body === undefined || body === null) {
    return {};
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "receipt print body must be an object", "INVALID_RECEIPT_PRINT");
  }

  const record = body as Record<string, unknown>;
  if (record.printerId !== undefined && record.printerId !== null && typeof record.printerId !== "string") {
    throw new HttpError(400, "printerId must be a string or null", "INVALID_RECEIPT_PRINT");
  }
  if (record.printerKey !== undefined && record.printerKey !== null && typeof record.printerKey !== "string") {
    throw new HttpError(400, "printerKey must be a string or null", "INVALID_RECEIPT_PRINT");
  }
  if (
    record.workstationKey !== undefined
    && record.workstationKey !== null
    && typeof record.workstationKey !== "string"
  ) {
    throw new HttpError(400, "workstationKey must be a string or null", "INVALID_RECEIPT_PRINT");
  }
  if (
    record.copies !== undefined
    && record.copies !== null
    && (!Number.isInteger(record.copies) || Number(record.copies) <= 0)
  ) {
    throw new HttpError(400, "copies must be a positive integer", "INVALID_RECEIPT_PRINT");
  }

  return {
    printerId: record.printerId as string | null | undefined,
    printerKey: record.printerKey as string | null | undefined,
    workstationKey: record.workstationKey as string | null | undefined,
    copies: record.copies as number | null | undefined,
  };
};

export const getSaleReceiptHandler = async (req: Request, res: Response) => {
  const receipt = await getSaleReceiptById(req.params.saleId);
  res.json(receipt);
};

export const issueReceiptHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { saleId?: unknown; refundId?: unknown };
  if (body.saleId !== undefined && typeof body.saleId !== "string") {
    throw new HttpError(400, "saleId must be a string", "INVALID_RECEIPT_ISSUE");
  }
  if (body.refundId !== undefined && typeof body.refundId !== "string") {
    throw new HttpError(400, "refundId must be a string", "INVALID_RECEIPT_ISSUE");
  }

  const result = await issueReceipt({
    saleId: body.saleId,
    refundId: body.refundId,
    issuedByStaffId: getRequestStaffActorId(req),
  });

  res.status(result.idempotent ? 200 : 201).json(result);
};

export const getReceiptByNumberHandler = async (req: Request, res: Response) => {
  const result = await getReceiptByNumber(req.params.receiptNumber);
  res.json(result);
};

export const prepareSaleReceiptPrintHandler = async (req: Request, res: Response) => {
  const result = await prepareSaleReceiptPrint(req.params.saleId, toReceiptPrintInput(req.body));
  res.json(result);
};

export const printSaleReceiptHandler = async (req: Request, res: Response) => {
  const result = await queueSaleReceiptPrint(
    req.params.saleId,
    toReceiptPrintInput(req.body),
    getRequestStaffActorId(req),
    getRequestAuditActor(req),
  );
  res.status(202).json(result);
};

export const emailSaleReceiptHandler = async (req: Request, res: Response) => {
  const result = await emailSaleReceiptById(req.params.saleId);
  res.status(202).json(result);
};
