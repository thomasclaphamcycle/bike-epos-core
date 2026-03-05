import { Request, Response } from "express";
import { HttpError } from "../utils/http";
import { wrapAuthedPage } from "../views/appShell";
import { renderManagerCashPage } from "../views/managerCashPage";
import { renderManagerRefundsPage } from "../views/managerRefundsPage";

const setUiHeaders = (res: Response) => {
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

export const getManagerCashPageHandler = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

  setUiHeaders(res);
  res.type("html").send(
    wrapAuthedPage({
      html: renderManagerCashPage(),
      title: "Manager Cash",
      user: req.user,
      activeNav: "manager-cash",
    }),
  );
};

export const getManagerRefundsPageHandler = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

  setUiHeaders(res);
  res.type("html").send(
    wrapAuthedPage({
      html: renderManagerRefundsPage(),
      title: "Manager Refunds",
      user: req.user,
      activeNav: "manager-refunds",
    }),
  );
};
