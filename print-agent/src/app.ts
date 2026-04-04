import express, { type ErrorRequestHandler } from "express";
import type { AddressInfo } from "node:net";
import {
  validateShipmentPrintAgentSubmitRequest,
  type ShipmentPrintAgentSubmitResponse,
} from "../../shared/shippingPrintContract";
import type { PrintAgentConfig } from "./config";
import { loadPrintAgentConfig } from "./config";
import { submitShipmentPrintJob } from "./transport";

type PrintAgentError = Error & {
  statusCode?: number;
  code?: string;
};

const createHttpError = (statusCode: number, code: string, message: string): PrintAgentError => {
  const error = new Error(message) as PrintAgentError;
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const requireSecret = (providedSecret: string | undefined, config: PrintAgentConfig) => {
  if (!config.sharedSecret) {
    return;
  }

  if (!providedSecret || providedSecret !== config.sharedSecret) {
    throw createHttpError(401, "PRINT_AGENT_UNAUTHORIZED", "Print agent secret was missing or invalid");
  }
};

export const createPrintAgentApp = (config: PrintAgentConfig = loadPrintAgentConfig()) => {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      transportMode: config.transportMode,
      printerName: config.defaultPrinterName,
      bindHost: config.bindHost,
      port: config.port,
    });
  });

  app.post("/jobs/shipment-label", async (req, res, next) => {
    try {
      requireSecret(req.header("X-CorePOS-Print-Agent-Secret") ?? undefined, config);
      let payload;
      try {
        payload = validateShipmentPrintAgentSubmitRequest(req.body);
      } catch (error) {
        throw createHttpError(
          400,
          "PRINT_AGENT_REQUEST_INVALID",
          error instanceof Error ? error.message : "Print request payload was invalid",
        );
      }

      let job;
      try {
        job = await submitShipmentPrintJob(payload.printRequest, config);
      } catch (error) {
        throw createHttpError(
          502,
          "PRINT_AGENT_TRANSPORT_FAILED",
          error instanceof Error ? error.message : "Print transport failed",
        );
      }

      const response: ShipmentPrintAgentSubmitResponse = {
        ok: true,
        job,
      };
      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const statusCode = typeof error?.statusCode === "number" ? error.statusCode : 500;
    const code = typeof error?.code === "string" ? error.code : "PRINT_AGENT_REQUEST_INVALID";
    const message = error instanceof Error ? error.message : "Unexpected print agent error";
    res.status(statusCode).json({
      error: {
        code,
        message,
      },
    });
  };

  app.use(errorHandler);
  return app;
};

export type PrintAgentServerHandle = {
  config: PrintAgentConfig;
  host: string;
  port: number;
  close: () => Promise<void>;
};

export const startPrintAgentServer = async (
  config: PrintAgentConfig = loadPrintAgentConfig(),
): Promise<PrintAgentServerHandle> => {
  const app = createPrintAgentApp(config);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const listener = app.listen(config.port, config.bindHost, () => {
      resolve(listener);
    });
    listener.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Print agent did not expose a TCP address");
  }

  return {
    config,
    host: address.address,
    port: (address as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
};
