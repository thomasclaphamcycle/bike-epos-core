import { Request, Response } from "express";
import {
  createCustomer,
  getCustomerById,
  searchCustomers,
} from "../services/customerService";

export const createCustomerHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    notes?: string;
  };

  const customer = await createCustomer(body);
  res.status(201).json(customer);
};

export const getCustomerHandler = async (req: Request, res: Response) => {
  const customer = await getCustomerById(req.params.id);
  res.json(customer);
};

export const listCustomersHandler = async (req: Request, res: Response) => {
  const query = typeof req.query.query === "string" ? req.query.query : undefined;
  const result = await searchCustomers(query);
  res.json(result);
};
