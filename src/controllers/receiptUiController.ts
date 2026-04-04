import { Request, Response } from "express";
import { getRequestStaffActorId } from "../middleware/staffRole";
import { getReceiptByNumber, issueReceipt } from "../services/receiptService";
import { renderReceiptPage } from "../views/receiptPage";

const setReceiptPageHeaders = (res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: http: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
    ].join("; "),
  );
};

export const getReceiptPageBySaleIdHandler = async (req: Request, res: Response) => {
  const issued = await issueReceipt({
    saleId: req.params.saleId,
    issuedByStaffId: getRequestStaffActorId(req),
  });

  const receipt = await getReceiptByNumber(issued.receipt.receiptNumber);
  const html = renderReceiptPage({ receipt });

  setReceiptPageHeaders(res);
  res.type("html").send(html);
};

export const getReceiptPageByNumberHandler = async (req: Request, res: Response) => {
  const receipt = await getReceiptByNumber(req.params.receiptNumber);
  const html = renderReceiptPage({ receipt });

  setReceiptPageHeaders(res);
  res.type("html").send(html);
};
