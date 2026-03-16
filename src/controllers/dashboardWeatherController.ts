import { Request, Response } from "express";
import { getDashboardWeather } from "../services/dashboardWeatherService";

export const dashboardWeatherHandler = async (_req: Request, res: Response) => {
  const weather = await getDashboardWeather();
  res.json({ weather });
};
