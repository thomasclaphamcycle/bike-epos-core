import { Request, Response } from "express";
import { HttpError } from "../utils/http";
import { wrapAuthedPage } from "../views/appShell";
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

export const getAdminPageHandler = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }
  setPageHeaders(res);
  res.type("html").send(
    wrapAuthedPage({
      html: renderAdminPage(),
      title: "Admin Users",
      user: req.user,
      activeNav: "admin-users",
    }),
  );
};

export const getAdminAuditPageHandler = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }
  setPageHeaders(res);
  res.type("html").send(
    wrapAuthedPage({
      html: renderAdminAuditPage(),
      title: "Admin Audit",
      user: req.user,
      activeNav: "admin-audit",
    }),
  );
};
