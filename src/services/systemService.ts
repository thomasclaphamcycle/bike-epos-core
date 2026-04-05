import { getRuntimeDiagnosticsSnapshot } from "./runtimeDiagnosticsService";

export const getRuntimeVersionInfo = () => {
  return getRuntimeDiagnosticsSnapshot();
};
