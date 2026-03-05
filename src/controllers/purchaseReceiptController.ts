import { Request, Response } from "express";
import { getPurchaseReceiptById } from "../services/purchasingService";

export const getPurchaseReceiptHandler = async (req: Request, res: Response) => {
  const result = await getPurchaseReceiptById(req.params.id);
  res.json(result);
};
