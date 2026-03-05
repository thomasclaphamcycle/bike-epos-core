import { Request, Response } from "express";
import { getRequestStaffActorId, getRequestStaffRole } from "../middleware/staffRole";
import { renderInventoryAdjustPage } from "../views/inventoryAdjustPage";

export const getInventoryAdjustPageHandler = async (req: Request, res: Response) => {
  const html = renderInventoryAdjustPage({
    staffRole: getRequestStaffRole(req),
    staffId: getRequestStaffActorId(req),
  });

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
