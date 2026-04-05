import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { isCorePosDebugEnabled, isOperationalLoggingEnabled } from "../lib/operationalLogger";
import { REQUEST_ID_HEADER } from "../middleware/requestContext";

const DEFAULT_APP_NAME = "CorePOS";
const DEFAULT_APP_VERSION = "0.0.0";
const DEFAULT_PRINT_AGENT_TIMEOUT_MS = 7000;
const SEMVERISH_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

type PackageJsonShape = {
  name?: string;
  version?: string;
};

export type RuntimeDiagnosticsSnapshot = {
  app: {
    name: string;
    version: string;
    label: string;
    revision: string | null;
    releaseLabel: string;
  };
  runtime: {
    environment: string;
    observedAt: string;
    startedAt: string;
    uptimeSeconds: number;
    pid: number;
    nodeVersion: string;
    platform: NodeJS.Platform;
    arch: string;
    timezone: string;
  };
  diagnostics: {
    requestIdHeader: string;
    corePosDebugEnabled: boolean;
    opsLoggingEnabled: boolean;
  };
  features: {
    authMode: string;
    frontendServingMode: "frontend-dist" | "backend-routes";
    frontendBundlePresent: boolean;
    shippingPrintAgentConfigured: boolean;
    shippingPrintAgentTimeoutMs: number;
  };
};

const projectRoot = process.cwd();
const packageJsonPath = path.join(projectRoot, "package.json");
const frontendIndexFile = path.join(projectRoot, "frontend", "dist", "index.html");
const processStartedAt = new Date().toISOString();

const readPackageMetadata = (): PackageJsonShape => {
  try {
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    return JSON.parse(raw) as PackageJsonShape;
  } catch {
    return {};
  }
};

const packageMetadata = readPackageMetadata();

const resolveAppVersion = () => {
  const explicitVersion = process.env.APP_VERSION?.trim();
  if (explicitVersion && SEMVERISH_VERSION.test(explicitVersion)) {
    return explicitVersion;
  }

  return packageMetadata.version?.trim() || DEFAULT_APP_VERSION;
};

const resolveAppRevision = () => {
  const explicitVersion = process.env.APP_VERSION?.trim();
  const explicitRevision =
    process.env.APP_REVISION?.trim() ||
    process.env.GIT_SHA?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    (explicitVersion && !SEMVERISH_VERSION.test(explicitVersion) ? explicitVersion : "");

  if (explicitRevision) {
    return explicitRevision;
  }

  try {
    const revision = execSync("git rev-parse --short HEAD", {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return revision.length > 0 ? revision : null;
  } catch {
    return null;
  }
};

const appVersion = resolveAppVersion();
const appRevision = resolveAppRevision();

const resolveTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  } catch {
    return "unknown";
  }
};

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const getFrontendServingMode = (
  environment: string,
  frontendBundlePresent: boolean,
): "frontend-dist" | "backend-routes" =>
  environment === "production" && frontendBundlePresent ? "frontend-dist" : "backend-routes";

export const getRuntimeDiagnosticsSnapshot = (): RuntimeDiagnosticsSnapshot => {
  const environment = process.env.NODE_ENV?.trim() || "development";
  const frontendBundlePresent = fs.existsSync(frontendIndexFile);
  const shippingPrintAgentConfigured =
    (process.env.COREPOS_SHIPPING_PRINT_AGENT_URL?.trim() || "").length > 0;

  return {
    app: {
      name: packageMetadata.name?.trim() || DEFAULT_APP_NAME,
      version: appVersion,
      label: `v${appVersion}`,
      revision: appRevision,
      releaseLabel: appRevision ? `v${appVersion} (${appRevision})` : `v${appVersion}`,
    },
    runtime: {
      environment,
      observedAt: new Date().toISOString(),
      startedAt: processStartedAt,
      uptimeSeconds: Number(process.uptime().toFixed(3)),
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      timezone: resolveTimezone(),
    },
    diagnostics: {
      requestIdHeader: REQUEST_ID_HEADER,
      corePosDebugEnabled: isCorePosDebugEnabled(),
      opsLoggingEnabled: isOperationalLoggingEnabled(),
    },
    features: {
      authMode: (process.env.AUTH_MODE?.trim() || "real").toLowerCase(),
      frontendServingMode: getFrontendServingMode(environment, frontendBundlePresent),
      frontendBundlePresent,
      shippingPrintAgentConfigured,
      shippingPrintAgentTimeoutMs: parsePositiveInteger(
        process.env.COREPOS_SHIPPING_PRINT_AGENT_TIMEOUT_MS,
        DEFAULT_PRINT_AGENT_TIMEOUT_MS,
      ),
    },
  };
};
