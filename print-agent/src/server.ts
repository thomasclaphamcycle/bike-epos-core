import { loadPrintAgentConfig } from "./config";
import { startPrintAgentServer } from "./app";

const main = async () => {
  const config = loadPrintAgentConfig();
  const handle = await startPrintAgentServer(config);
  console.log(
    `[print-agent] Listening on http://${handle.host}:${handle.port} using ${config.transportMode} transport for ${config.defaultPrinterName}`,
  );
};

main().catch((error) => {
  console.error(`[print-agent] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
