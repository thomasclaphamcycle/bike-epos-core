type OperationalLogPayload = Record<string, unknown>;

const isOperationalLoggingEnabled = () => process.env.OPS_LOGGING === "1";

const omitUndefined = (payload: OperationalLogPayload) =>
  Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

export const logOperationalEvent = (
  event: string,
  payload: OperationalLogPayload = {},
) => {
  if (!isOperationalLoggingEnabled()) {
    return;
  }

  console.info(`[ops] ${JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...omitUndefined(payload),
  })}`);
};
