import { Request, Response } from "express";
import { HttpError } from "../utils/http";
import { wrapAuthedPage } from "../views/appShell";
import { renderTillPage } from "../views/tillPage";

export const getTillPageHandler = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

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
  res.type("html").send(
    wrapAuthedPage({
      html: renderTillPage(),
      title: "Till / Cash Up",
      user: req.user,
      activeNav: "till",
    }),
  );
};
