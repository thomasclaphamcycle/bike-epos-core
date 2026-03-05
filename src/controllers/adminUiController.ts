import { Request, Response } from "express";
import { renderAdminPage } from "../views/adminPage";
import { renderAdminAuditPage } from "../views/adminAuditPage";

const setPageHeaders = (res: Response) => {
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

export const getAdminPageHandler = async (_req: Request, res: Response) => {
  setPageHeaders(res);
  res.type("html").send(renderAdminPage());
};

export const getAdminAuditPageHandler = async (_req: Request, res: Response) => {
  setPageHeaders(res);
  res.type("html").send(renderAdminAuditPage());
};
