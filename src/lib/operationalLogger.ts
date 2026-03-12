type OperationalLogPayload = Record<string, unknown>;

const isOperationalLoggingEnabled = () => process.env.OPS_LOGGING === "1";

const RESERVED_KEYS = new Set(["operation", "entityId", "resultStatus"]);

const omitUndefined = (payload: OperationalLogPayload) =>
  Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

const omitReservedKeys = (payload: OperationalLogPayload) =>
  Object.fromEntries(
    Object.entries(payload).filter(([key]) => !RESERVED_KEYS.has(key)),
  );

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

  console.info(`[ops] ${JSON.stringify({
    timestamp: new Date().toISOString(),
    operation,
    entityId,
    resultStatus,
    ...omitUndefined(omitReservedKeys(payload)),
  })}`);
};
