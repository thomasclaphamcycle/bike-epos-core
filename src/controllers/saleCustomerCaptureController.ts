import { Request, Response } from "express";
import { getRequestAuditActor } from "../middleware/staffRole";
import { HttpError } from "../utils/http";
import {
  createBasketCustomerCaptureSession,
  createSaleCustomerCaptureSession,
  getCurrentBasketCustomerCaptureSession,
  getPublicCustomerCaptureStationEntry,
  getCurrentSaleCustomerCaptureSession,
  getPublicSaleCustomerCaptureSession,
  submitPublicSaleCustomerCapture,
} from "../services/saleCustomerCaptureService";

export const createSaleCustomerCaptureSessionHandler = async (req: Request, res: Response) => {
  const stationKey = typeof req.body?.stationKey === "string" ? req.body.stationKey : undefined;
  if (req.body?.stationKey !== undefined && typeof req.body.stationKey !== "string") {
    throw new HttpError(400, "stationKey must be a string", "INVALID_CUSTOMER_CAPTURE");
  }

  const result = await createSaleCustomerCaptureSession(
    req.params.saleId,
    stationKey,
    getRequestAuditActor(req),
  );
  res.status(201).json(result);
};

export const getCurrentSaleCustomerCaptureSessionHandler = async (req: Request, res: Response) => {
  const result = await getCurrentSaleCustomerCaptureSession(req.params.saleId);
  res.json(result);
};

export const createBasketCustomerCaptureSessionHandler = async (req: Request, res: Response) => {
  const stationKey = typeof req.body?.stationKey === "string" ? req.body.stationKey : undefined;
  if (req.body?.stationKey !== undefined && typeof req.body.stationKey !== "string") {
    throw new HttpError(400, "stationKey must be a string", "INVALID_CUSTOMER_CAPTURE");
  }

  const result = await createBasketCustomerCaptureSession(
    req.params.basketId,
    stationKey,
    getRequestAuditActor(req),
  );
  res.status(201).json(result);
};

export const getCurrentBasketCustomerCaptureSessionHandler = async (req: Request, res: Response) => {
  const result = await getCurrentBasketCustomerCaptureSession(req.params.basketId);
  res.json(result);
};

export const getPublicSaleCustomerCaptureSessionHandler = async (req: Request, res: Response) => {
  const result = await getPublicSaleCustomerCaptureSession(req.params.token);
  res.json(result);
};

export const getPublicCustomerCaptureStationEntryHandler = async (req: Request, res: Response) => {
  const result = await getPublicCustomerCaptureStationEntry(req.params.station);
  res.json(result);
};

export const submitPublicSaleCustomerCaptureHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    firstName?: unknown;
    lastName?: unknown;
    email?: unknown;
    phone?: unknown;
    emailMarketingConsent?: unknown;
    smsMarketingConsent?: unknown;
  };

  if (body.firstName !== undefined && typeof body.firstName !== "string") {
    throw new HttpError(400, "firstName must be a string", "INVALID_CUSTOMER_CAPTURE");
  }
  if (body.lastName !== undefined && typeof body.lastName !== "string") {
    throw new HttpError(400, "lastName must be a string", "INVALID_CUSTOMER_CAPTURE");
  }
  if (body.email !== undefined && typeof body.email !== "string") {
    throw new HttpError(400, "email must be a string", "INVALID_CUSTOMER_CAPTURE");
  }
  if (body.phone !== undefined && typeof body.phone !== "string") {
    throw new HttpError(400, "phone must be a string", "INVALID_CUSTOMER_CAPTURE");
  }
  if (
    body.emailMarketingConsent !== undefined &&
    typeof body.emailMarketingConsent !== "boolean"
  ) {
    throw new HttpError(
      400,
      "emailMarketingConsent must be a boolean",
      "INVALID_CUSTOMER_CAPTURE",
    );
  }
  if (
    body.smsMarketingConsent !== undefined &&
    typeof body.smsMarketingConsent !== "boolean"
  ) {
    throw new HttpError(
      400,
      "smsMarketingConsent must be a boolean",
      "INVALID_CUSTOMER_CAPTURE",
    );
  }

  const result = await submitPublicSaleCustomerCapture(req.params.token, {
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone,
    emailMarketingConsent: body.emailMarketingConsent,
    smsMarketingConsent: body.smsMarketingConsent,
  });

  res.status(201).json(result);
};
