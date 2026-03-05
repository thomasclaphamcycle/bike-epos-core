import { Request, Response } from "express";
import { getSaleReceiptById } from "../services/receiptService";

export const getSaleReceiptHandler = async (req: Request, res: Response) => {
  const receipt = await getSaleReceiptById(req.params.saleId);
  res.json(receipt);
};
