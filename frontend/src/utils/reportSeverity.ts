import type { CSSProperties } from "react";

export type ReportSeverity = "CRITICAL" | "WARNING" | "INFO";

export const reportSeverityRowAccent: Record<ReportSeverity, CSSProperties> = {
  CRITICAL: { backgroundColor: "rgba(194, 58, 58, 0.14)" },
  WARNING: { backgroundColor: "rgba(214, 148, 34, 0.14)" },
  INFO: {},
};

export const reportSeverityBadgeClass: Record<ReportSeverity, string> = {
  CRITICAL: "status-badge status-cancelled",
  WARNING: "status-badge status-warning",
  INFO: "status-badge",
};
