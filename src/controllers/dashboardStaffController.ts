import { Request, Response } from "express";
import { getDashboardStaffToday, normalizeDateKeyOrThrow } from "../services/rotaService";

export const dashboardStaffTodayHandler = async (req: Request, res: Response) => {
  const date = typeof req.query.date === "string"
    ? normalizeDateKeyOrThrow(req.query.date, "INVALID_DASHBOARD_DATE")
    : undefined;

  const staffToday = await getDashboardStaffToday({ date });
  res.json({ staffToday });
};
