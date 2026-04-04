import path from "node:path";

const DEFAULT_BIND_HOST = "127.0.0.1";
const DEFAULT_PORT = 3211;
const DEFAULT_DRY_RUN_OUTPUT_DIR = path.resolve(process.cwd(), "tmp", "print-agent-output");
const DEFAULT_RAW_TCP_TIMEOUT_MS = 5000;

const parsePositiveInteger = (value: string | undefined, fallback: number, field: string) => {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }

  return parsed;
};

export type PrintAgentConfig = {
  bindHost: string;
  port: number;
  sharedSecret: string | null;
  dryRunOutputDir: string;
  rawTcpTimeoutMs: number;
};

export const loadPrintAgentConfig = (env: NodeJS.ProcessEnv = process.env): PrintAgentConfig => {
  const bindHost = env.COREPOS_PRINT_AGENT_BIND_HOST?.trim() || DEFAULT_BIND_HOST;
  const port = parsePositiveInteger(env.COREPOS_PRINT_AGENT_PORT, DEFAULT_PORT, "COREPOS_PRINT_AGENT_PORT");
  const sharedSecret = env.COREPOS_PRINT_AGENT_SHARED_SECRET?.trim() || null;
  const dryRunOutputDir = env.COREPOS_PRINT_AGENT_OUTPUT_DIR?.trim()
    ? path.resolve(process.cwd(), env.COREPOS_PRINT_AGENT_OUTPUT_DIR)
    : DEFAULT_DRY_RUN_OUTPUT_DIR;
  const rawTcpTimeoutMs = parsePositiveInteger(env.COREPOS_PRINT_AGENT_RAW_TCP_TIMEOUT_MS, DEFAULT_RAW_TCP_TIMEOUT_MS, "COREPOS_PRINT_AGENT_RAW_TCP_TIMEOUT_MS");

  return {
    bindHost,
    port,
    sharedSecret,
    dryRunOutputDir,
    rawTcpTimeoutMs,
  };
};
