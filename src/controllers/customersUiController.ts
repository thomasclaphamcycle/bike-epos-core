import { Request, Response } from "express";
import { HttpError } from "../utils/http";
import { getRequestStaffActorId, getRequestStaffRole } from "../middleware/staffRole";
import { wrapAuthedPage } from "../views/appShell";
import { renderCustomersPage } from "../views/customersPage";
import { renderCustomerProfilePage } from "../views/customerProfilePage";

export const getCustomersPageHandler = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

  const bodyHtml = renderCustomersPage({
    staffRole: getRequestStaffRole(req),
    staffId: getRequestStaffActorId(req),
  });
  const html = wrapAuthedPage({
    html: bodyHtml,
    title: "Customers",
    user: req.user,
    activeNav: "customers",
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

export const getCustomerProfilePageHandler = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

  const bodyHtml = renderCustomerProfilePage({
    customerId: req.params.id,
    staffRole: getRequestStaffRole(req),
    staffId: getRequestStaffActorId(req),
  });
  const html = wrapAuthedPage({
    html: bodyHtml,
    title: "Customer Profile",
    user: req.user,
    activeNav: "customers",
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
