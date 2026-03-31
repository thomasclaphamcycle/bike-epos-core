import type { Request } from "express";
import {
  isCorePosDebugEnabled,
  logCorePosDebug,
  logCorePosError,
  logCorePosEvent,
} from "../lib/operationalLogger";

type LoggerPayload = Record<string, unknown>;

type RequestLike = Pick<Request, "requestId" | "user">;

const getRequestLoggerContext = (req: RequestLike): LoggerPayload => ({
  requestId: req.requestId ?? null,
  userId: req.user?.id ?? null,
  userRole: req.user?.role ?? null,
});

export const logger = {
  info(operation: string, payload: LoggerPayload = {}) {
    logCorePosEvent(operation, payload, "info");
  },
  warn(operation: string, payload: LoggerPayload = {}) {
    logCorePosEvent(operation, payload, "warn");
  },
  error(operation: string, error: unknown, payload: LoggerPayload = {}) {
    logCorePosError(operation, error, payload, "error");
  },
  debug(operation: string, payload: LoggerPayload = {}) {
    if (!isCorePosDebugEnabled()) {
      return;
    }

    logCorePosDebug(operation, payload);
  },
};

export const createRequestLogger = (req: RequestLike) => {
  const context = getRequestLoggerContext(req);

  return {
    requestId: context.requestId,
    info(operation: string, payload: LoggerPayload = {}) {
      logger.info(operation, {
        ...context,
        ...payload,
      });
    },
    warn(operation: string, payload: LoggerPayload = {}) {
      logger.warn(operation, {
        ...context,
        ...payload,
      });
    },
    error(operation: string, error: unknown, payload: LoggerPayload = {}) {
      logger.error(operation, error, {
        ...context,
        ...payload,
      });
    },
    debug(operation: string, payload: LoggerPayload = {}) {
      logger.debug(operation, {
        ...context,
        ...payload,
      });
    },
  };
};
