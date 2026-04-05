import { getRequestContext } from "./requestContext";

type OperationalLogPayload = Record<string, unknown>;

export const isOperationalLoggingEnabled = () => process.env.OPS_LOGGING === "1";
export const isCorePosDebugEnabled = () => process.env.COREPOS_DEBUG === "1";

const RESERVED_KEYS = new Set(["operation", "entityId", "resultStatus"]);

const omitUndefined = (payload: OperationalLogPayload) =>
  Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

const omitReservedKeys = (payload: OperationalLogPayload) =>
  Object.fromEntries(
    Object.entries(payload).filter(([key]) => !RESERVED_KEYS.has(key)),
  );

const stringifyLogValue = (value: unknown) => {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === "bigint") {
        return currentValue.toString();
      }

      if (currentValue && typeof currentValue === "object") {
        if (seen.has(currentValue)) {
          return "[Circular]";
        }
        seen.add(currentValue);
      }

      return currentValue;
    });
  } catch (error) {
    return JSON.stringify({
      serializationError: error instanceof Error ? error.message : String(error),
    });
  }
};

const withRequestContext = (payload: OperationalLogPayload) => {
  const requestContext = getRequestContext();
  if (!requestContext) {
    return payload;
  }

  return {
    requestId: requestContext.requestId,
    actorStaffId: requestContext.actorStaffId ?? null,
    method: requestContext.method,
    route: requestContext.route,
    ...payload,
  };
};

const toErrorMetadata = (error: unknown) => {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: unknown };
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorCode:
        typeof errorWithCode.code === "string" || typeof errorWithCode.code === "number"
          ? String(errorWithCode.code)
          : null,
      stack: error.stack ?? null,
    };
  }

  return {
    errorName: "NonErrorThrown",
    errorMessage: typeof error === "string" ? error : stringifyLogValue(error),
    errorCode: null,
    stack: null,
  };
};

const writeStructuredLog = (
  channel: string,
  payload: OperationalLogPayload,
  level: "info" | "warn" | "error" = "info",
) => {
  console[level](`[${channel}] ${stringifyLogValue({
    timestamp: new Date().toISOString(),
    ...omitUndefined(withRequestContext(payload)),
  })}`);
};

export const logOperationalEvent = (
  operation: string,
  payload: OperationalLogPayload = {},
) => {
  if (!isOperationalLoggingEnabled()) {
    return;
  }

  const entityId =
    payload.entityId ??
    payload.purchaseOrderId ??
    payload.workshopJobId ??
    payload.variantId ??
    payload.userId ??
    null;
  const resultStatus =
    typeof payload.resultStatus === "string" && payload.resultStatus.trim().length > 0
      ? payload.resultStatus
      : "succeeded";

  writeStructuredLog("ops", {
    operation,
    entityId,
    resultStatus,
    ...omitUndefined(omitReservedKeys(payload)),
  });
};

export const logCorePosEvent = (
  operation: string,
  payload: OperationalLogPayload = {},
  level: "info" | "warn" | "error" = "info",
) => {
  writeStructuredLog("corepos", { operation, ...payload }, level);
};

export const logCorePosDebug = (operation: string, payload: OperationalLogPayload = {}) => {
  if (!isCorePosDebugEnabled()) {
    return;
  }

  writeStructuredLog("corepos-debug", { operation, ...payload });
};

export const logCorePosError = (
  operation: string,
  error: unknown,
  payload: OperationalLogPayload = {},
  level: "warn" | "error" = "error",
) => {
  const metadata = toErrorMetadata(error);
  logCorePosEvent(
    operation,
    {
      ...payload,
      errorName: metadata.errorName,
      errorMessage: metadata.errorMessage,
      errorCode: metadata.errorCode,
    },
    level,
  );

  if (isCorePosDebugEnabled()) {
    logCorePosDebug(`${operation}.detail`, {
      ...payload,
      errorName: metadata.errorName,
      errorMessage: metadata.errorMessage,
      errorCode: metadata.errorCode,
      stack: metadata.stack,
    });
  }
};
