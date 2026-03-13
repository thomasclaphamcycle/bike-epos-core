type OperationalLogPayload = Record<string, unknown>;

const isOperationalLoggingEnabled = () => process.env.OPS_LOGGING === "1";
export const isCorePosDebugEnabled = () => process.env.COREPOS_DEBUG === "1";

const RESERVED_KEYS = new Set(["operation", "entityId", "resultStatus"]);

const omitUndefined = (payload: OperationalLogPayload) =>
  Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

const omitReservedKeys = (payload: OperationalLogPayload) =>
  Object.fromEntries(
    Object.entries(payload).filter(([key]) => !RESERVED_KEYS.has(key)),
  );

const writeStructuredLog = (
  channel: string,
  payload: OperationalLogPayload,
  level: "info" | "warn" | "error" = "info",
) => {
  console[level](`[${channel}] ${JSON.stringify({
    timestamp: new Date().toISOString(),
    ...omitUndefined(payload),
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
