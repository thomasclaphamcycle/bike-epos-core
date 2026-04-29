import { Request, Response } from "express";
import { getRequestStaffActorId } from "../middleware/staffRole";
import {
  cancelCardTerminalSession,
  createCardTerminalSaleSession,
  getCardTerminalIntegrationConfig,
  listCardTerminals,
  refreshCardTerminalSession,
  respondToCardTerminalSignature,
} from "../services/cardTerminalService";
import { HttpError } from "../utils/http";

const getRequestRemoteAddress = (req: Request) =>
  req.ip || req.socket.remoteAddress || null;

export const getCardTerminalConfigHandler = async (req: Request, res: Response) => {
  res.json(getCardTerminalIntegrationConfig(getRequestRemoteAddress(req)));
};

export const listCardTerminalsHandler = async (req: Request, res: Response) => {
  const status =
    typeof req.query.status === "string"
      ? req.query.status
      : typeof req.query.statuses === "string"
        ? req.query.statuses
        : undefined;

  const result = await listCardTerminals(status);
  res.json(result);
};

export const createCardTerminalSaleSessionHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    saleId?: unknown;
    amountPence?: unknown;
    terminalId?: unknown;
  };

  if (body.saleId !== undefined && typeof body.saleId !== "string") {
    throw new HttpError(400, "saleId must be a string", "INVALID_CARD_TERMINAL_SESSION");
  }
  if (body.amountPence !== undefined && typeof body.amountPence !== "number") {
    throw new HttpError(400, "amountPence must be a number", "INVALID_CARD_TERMINAL_SESSION");
  }
  if (body.terminalId !== undefined && typeof body.terminalId !== "string") {
    throw new HttpError(400, "terminalId must be a string", "INVALID_CARD_TERMINAL_SESSION");
  }

  const result = await createCardTerminalSaleSession(
    {
      ...(body.saleId !== undefined ? { saleId: body.saleId } : {}),
      ...(body.amountPence !== undefined ? { amountPence: body.amountPence } : {}),
      ...(body.terminalId !== undefined ? { terminalId: body.terminalId } : {}),
    },
    getRequestStaffActorId(req),
  );
  res.status(201).json(result);
};

export const refreshCardTerminalSessionHandler = async (req: Request, res: Response) => {
  const result = await refreshCardTerminalSession(req.params.id, getRequestStaffActorId(req));
  res.json(result);
};

export const cancelCardTerminalSessionHandler = async (req: Request, res: Response) => {
  const result = await cancelCardTerminalSession(req.params.id);
  res.json(result);
};

export const respondToCardTerminalSignatureHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    accepted?: unknown;
  };

  if (body.accepted !== undefined && typeof body.accepted !== "boolean") {
    throw new HttpError(400, "accepted must be a boolean", "INVALID_SIGNATURE_RESPONSE");
  }

  const result = await respondToCardTerminalSignature(
    req.params.id,
    {
      ...(body.accepted !== undefined ? { accepted: body.accepted } : {}),
    },
    getRequestStaffActorId(req),
  );
  res.json(result);
};
