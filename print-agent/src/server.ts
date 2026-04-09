import { loadPrintAgentConfig } from "./config";
import { startPrintAgentServer } from "./app";

const main = async () => {
  const config = loadPrintAgentConfig();
  const handle = await startPrintAgentServer(config);
  console.log(
    `[print-agent] Listening on http://${handle.host}:${handle.port} with shipment-label (DRY_RUN/RAW_TCP/WINDOWS_PRINTER), receipt (DRY_RUN/RAW_TCP/WINDOWS_PRINTER), product-label (DRY_RUN/WINDOWS_PRINTER), and bike-tag (DRY_RUN/WINDOWS_PRINTER) support`,
  );
};

main().catch((error) => {
  console.error(`[print-agent] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
