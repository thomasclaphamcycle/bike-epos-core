import { Request, Response } from "express";
import { getRequestStaffActorId, getRequestStaffRole } from "../middleware/staffRole";
import { renderReportsPage } from "../views/reportsPage";

export const getReportsPageHandler = async (req: Request, res: Response) => {
  const html = renderReportsPage({
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
