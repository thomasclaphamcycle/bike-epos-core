import { Request, Response } from "express";
import { getRequestStaffActorId } from "../middleware/staffRole";
import { getReceiptByNumber, getSaleReceiptPrintById } from "../services/receiptService";
import { renderReceiptPage } from "../views/receiptPage";
import { renderSaleReceiptPage } from "../views/saleReceiptPage";
import { isUuid } from "../utils/http";

const setReceiptPageHeaders = (res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
    ].join("; "),
  );
};

export const getReceiptPageBySaleIdHandler = async (req: Request, res: Response) => {
  const payload = await getSaleReceiptPrintById(req.params.saleId, getRequestStaffActorId(req));
  const html = renderSaleReceiptPage({ receipt: payload });

  setReceiptPageHeaders(res);
  res.type("html").send(html);
};

export const getReceiptShortLinkHandler = async (req: Request, res: Response) => {
  const reference = req.params.saleOrReceiptRef;
  if (isUuid(reference)) {
    res.redirect(302, `/sales/${encodeURIComponent(reference)}/receipt`);
    return;
  }

  const receipt = await getReceiptByNumber(reference);
  const html = renderReceiptPage({ receipt });

  setReceiptPageHeaders(res);
  res.type("html").send(html);
};
