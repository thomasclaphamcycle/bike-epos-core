import { Request, Response } from "express";
import {
  getReceiptByNumber,
  getSaleReceiptById,
  issueReceipt,
} from "../services/receiptService";
import { getRequestStaffActorId } from "../middleware/staffRole";
import { HttpError } from "../utils/http";

export const getSaleReceiptHandler = async (req: Request, res: Response) => {
  const receipt = await getSaleReceiptById(req.params.saleId, getRequestStaffActorId(req));
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
