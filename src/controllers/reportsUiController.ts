import { Request, Response } from "express";
import { getRequestStaffActorId, getRequestStaffRole } from "../middleware/staffRole";
import { renderReportsPage } from "../views/reportsPage";
import { getDailyCloseReport } from "../services/reportService";
import { renderDailyClosePrintPage } from "../views/dailyClosePrintPage";

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

export const getDailyClosePrintPageHandler = async (req: Request, res: Response) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  const locationCode =
    typeof req.query.locationCode === "string" ? req.query.locationCode : undefined;

  const summary = await getDailyCloseReport({ date, locationCode });
  const html = renderDailyClosePrintPage({ summary });

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
