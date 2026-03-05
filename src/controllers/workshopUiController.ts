import { Request, Response } from "express";
import { HttpError } from "../utils/http";
import { getRequestStaffActorId, getRequestStaffRole } from "../middleware/staffRole";
import { wrapAuthedPage } from "../views/appShell";
import { renderWorkshopPage } from "../views/workshopPage";

export const getWorkshopPageHandler = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

  const bodyHtml = renderWorkshopPage({
    staffRole: getRequestStaffRole(req),
    staffId: getRequestStaffActorId(req),
  });
  const html = wrapAuthedPage({
    html: bodyHtml,
    title: "Workshop",
    user: req.user,
    activeNav: "workshop",
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
