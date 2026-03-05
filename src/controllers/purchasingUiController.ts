import { Request, Response } from "express";
import { HttpError } from "../utils/http";
import { getRequestStaffActorId, getRequestStaffRole } from "../middleware/staffRole";
import { wrapAuthedPage } from "../views/appShell";
import { renderPurchasingPage } from "../views/purchasingPage";
import { renderReceivingPage } from "../views/receivingPage";
import { renderSuppliersPage } from "../views/suppliersPage";

export const getPurchasingPageHandler = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

  const bodyHtml = renderPurchasingPage({
    staffRole: getRequestStaffRole(req),
    staffId: getRequestStaffActorId(req),
  });
  const html = wrapAuthedPage({
    html: bodyHtml,
    title: "Purchasing",
    user: req.user,
    activeNav: "purchasing",
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

export const getReceivingPageHandler = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

  const html = wrapAuthedPage({
    html: renderReceivingPage(),
    title: "Receiving",
    user: req.user,
    activeNav: "receiving",
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

export const getSuppliersPageHandler = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

  const html = wrapAuthedPage({
    html: renderSuppliersPage(),
    title: "Suppliers",
    user: req.user,
    activeNav: "suppliers",
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
