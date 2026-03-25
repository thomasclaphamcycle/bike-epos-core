import { Request, Response } from "express";
import { HttpError } from "../utils/http";
import { getRequestStaffActorId, getRequestStaffRole } from "../middleware/staffRole";
import { wrapAuthedPage } from "../views/appShell";
import { renderWorkshopPage } from "../views/workshopPage";
import { prisma } from "../lib/prisma";
import { renderWorkshopPrintPage } from "../views/workshopPrintPage";

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

export const getWorkshopPrintPageHandler = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

  const job = await prisma.workshopJob.findUnique({
    where: { id: req.params.id },
    include: {
      customer: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      lines: {
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });

  if (!job) {
    throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
  }

  const customerName = job.customerName
    ? job.customerName
    : job.customer
      ? [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" ").trim()
      : null;

  const lines = job.lines.map((line) => ({
    id: line.id,
    type: line.type,
    description: line.description,
    qty: line.qty,
    unitPricePence: line.unitPricePence,
    lineTotalPence: line.qty * line.unitPricePence,
  }));
  const subtotalPence = lines.reduce((sum, line) => sum + line.lineTotalPence, 0);

  const html = renderWorkshopPrintPage({
    job: {
      id: job.id,
      status: job.status,
      customerName,
      customerEmail: job.customer?.email ?? null,
      customerPhone: job.customer?.phone ?? null,
      bikeDescription: job.bikeDescription,
      notes: job.notes,
      scheduledDate: job.scheduledDate,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
    lines,
    totals: {
      subtotalPence,
    },
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
