import { Request, Response } from "express";
import { renderLoginPage } from "../views/loginPage";

const normalizeNextPath = (nextPath: unknown) => {
  if (typeof nextPath !== "string" || nextPath.trim().length === 0) {
    return "/pos";
  }
  const trimmed = nextPath.trim();
  if (!trimmed.startsWith("/")) {
    return "/pos";
  }
  return trimmed;
};

export const getLoginPageHandler = async (req: Request, res: Response) => {
  const nextPath = normalizeNextPath(req.query.next);
  const html = renderLoginPage({ nextPath });

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
