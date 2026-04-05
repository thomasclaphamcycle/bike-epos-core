import { apiGet } from "./client";

export type SystemVersionResponse = {
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
    platform: string;
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

export const getSystemVersion = () =>
  apiGet<SystemVersionResponse>("/api/system/version");
