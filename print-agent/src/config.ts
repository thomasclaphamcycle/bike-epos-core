import path from "node:path";
import type { PrintAgentTransportMode } from "../../shared/shippingPrintContract";

const DEFAULT_BIND_HOST = "127.0.0.1";
const DEFAULT_PORT = 3211;
const DEFAULT_PRINTER_NAME = "Dispatch Zebra GK420d";
const DEFAULT_DRY_RUN_OUTPUT_DIR = path.resolve(process.cwd(), "tmp", "print-agent-output");
const DEFAULT_RAW_TCP_PORT = 9100;
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

const parseTransportMode = (value: string | undefined): PrintAgentTransportMode => {
  const normalized = value?.trim().toUpperCase();
  if (!normalized || normalized.length === 0) {
    return "DRY_RUN";
  }
  if (normalized === "DRY_RUN" || normalized === "RAW_TCP") {
    return normalized;
  }

  throw new Error("COREPOS_PRINT_AGENT_TRANSPORT must be DRY_RUN or RAW_TCP");
};

export type PrintAgentConfig = {
  bindHost: string;
  port: number;
  transportMode: PrintAgentTransportMode;
  sharedSecret: string | null;
  defaultPrinterName: string;
  dryRunOutputDir: string;
  rawTcp: {
    host: string | null;
    port: number;
    timeoutMs: number;
  };
};

export const loadPrintAgentConfig = (env: NodeJS.ProcessEnv = process.env): PrintAgentConfig => {
  const transportMode = parseTransportMode(env.COREPOS_PRINT_AGENT_TRANSPORT);
  const bindHost = env.COREPOS_PRINT_AGENT_BIND_HOST?.trim() || DEFAULT_BIND_HOST;
  const port = parsePositiveInteger(env.COREPOS_PRINT_AGENT_PORT, DEFAULT_PORT, "COREPOS_PRINT_AGENT_PORT");
  const defaultPrinterName = env.COREPOS_PRINT_AGENT_DEFAULT_PRINTER_NAME?.trim() || DEFAULT_PRINTER_NAME;
  const sharedSecret = env.COREPOS_PRINT_AGENT_SHARED_SECRET?.trim() || null;
  const dryRunOutputDir = env.COREPOS_PRINT_AGENT_OUTPUT_DIR?.trim()
    ? path.resolve(process.cwd(), env.COREPOS_PRINT_AGENT_OUTPUT_DIR)
    : DEFAULT_DRY_RUN_OUTPUT_DIR;
  const rawTcpHost = env.COREPOS_PRINT_AGENT_RAW_TCP_HOST?.trim() || null;
  const rawTcpPort = parsePositiveInteger(
    env.COREPOS_PRINT_AGENT_RAW_TCP_PORT,
    DEFAULT_RAW_TCP_PORT,
    "COREPOS_PRINT_AGENT_RAW_TCP_PORT",
  );
  const rawTcpTimeoutMs = parsePositiveInteger(
    env.COREPOS_PRINT_AGENT_RAW_TCP_TIMEOUT_MS,
    DEFAULT_RAW_TCP_TIMEOUT_MS,
    "COREPOS_PRINT_AGENT_RAW_TCP_TIMEOUT_MS",
  );

  if (transportMode === "RAW_TCP" && !rawTcpHost) {
    throw new Error("COREPOS_PRINT_AGENT_RAW_TCP_HOST is required when COREPOS_PRINT_AGENT_TRANSPORT=RAW_TCP");
  }

  return {
    bindHost,
    port,
    transportMode,
    sharedSecret,
    defaultPrinterName,
    dryRunOutputDir,
    rawTcp: {
      host: rawTcpHost,
      port: rawTcpPort,
      timeoutMs: rawTcpTimeoutMs,
    },
  };
};
