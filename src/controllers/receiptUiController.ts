import { Request, Response } from "express";
import { getSaleReceiptById } from "../services/receiptService";
import { renderReceiptPage } from "../views/receiptPage";

export const getReceiptPageHandler = async (req: Request, res: Response) => {
  const receipt = await getSaleReceiptById(req.params.saleId);
  const html = renderReceiptPage({ receipt });

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

  res.type("html").send(html);
};
