import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { ShipmentPrintAgentJob, ShipmentPrintRequest } from "../../shared/shippingPrintContract";
import { SHIPMENT_LABEL_DOCUMENT_FORMAT } from "../../shared/shippingPrintContract";
import type { PrintAgentConfig } from "./config";

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "shipment";

const buildJobId = () => `printjob-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const buildPrintableContent = (request: ShipmentPrintRequest) =>
  Array.from({ length: request.printer.copies }, () => request.document.content).join("\n");

const shipmentWindowsPrintScriptPath = path.resolve(__dirname, "..", "scripts", "print_shipment_label_windows.ps1");

const executeDryRun = async (
  request: ShipmentPrintRequest,
  config: PrintAgentConfig,
  acceptedAt: string,
): Promise<ShipmentPrintAgentJob> => {
  const jobId = buildJobId();
  const payload = buildPrintableContent(request);
  const outputDir = config.dryRunOutputDir;
  const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${slugify(request.orderNumber)}-${slugify(request.trackingNumber)}.zpl`;
  const outputPath = path.join(outputDir, fileName);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, payload, "utf8");

  return {
    jobId,
    acceptedAt,
    completedAt: new Date().toISOString(),
    transportMode: "DRY_RUN",
    printerId: request.printer.printerId,
    printerKey: request.printer.printerKey,
    printerName: request.printer.printerName,
    printerTarget: `dry-run:${outputDir}`,
    copies: request.printer.copies,
    documentFormat: SHIPMENT_LABEL_DOCUMENT_FORMAT,
    bytesSent: Buffer.byteLength(payload, "utf8"),
    simulated: true,
    outputPath,
  };
};

const sendRawTcpPayload = async (host: string, port: number, timeoutMs: number, payload: string) => {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const socket = net.createConnection({ host, port });

    const finish = (error?: Error | null) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    socket.setTimeout(timeoutMs, () => {
      finish(new Error(`Raw TCP printer timed out after ${timeoutMs}ms`));
    });

    socket.once("error", (error) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });

    socket.once("connect", () => {
      socket.write(payload, "utf8", (error) => {
        if (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
          return;
        }

        socket.end();
      });
    });

    socket.once("close", (hadError) => {
      if (!hadError) {
        finish();
      }
    });
  });
};

const executeRawTcp = async (
  request: ShipmentPrintRequest,
  config: PrintAgentConfig,
  acceptedAt: string,
): Promise<ShipmentPrintAgentJob> => {
  const rawTcpHost = request.printer.rawTcpHost;
  if (!rawTcpHost) {
    throw new Error("Raw TCP printer host is not configured");
  }
  const rawTcpPort = request.printer.rawTcpPort;
  if (!rawTcpPort) {
    throw new Error("Raw TCP printer port is not configured");
  }

  const jobId = buildJobId();
  const payload = buildPrintableContent(request);
  await sendRawTcpPayload(rawTcpHost, rawTcpPort, config.rawTcpTimeoutMs, payload);

  return {
    jobId,
    acceptedAt,
    completedAt: new Date().toISOString(),
    transportMode: "RAW_TCP",
    printerId: request.printer.printerId,
    printerKey: request.printer.printerKey,
    printerName: request.printer.printerName,
    printerTarget: `${rawTcpHost}:${rawTcpPort}`,
    copies: request.printer.copies,
    documentFormat: SHIPMENT_LABEL_DOCUMENT_FORMAT,
    bytesSent: Buffer.byteLength(payload, "utf8"),
    simulated: false,
    outputPath: null,
  };
};

const invokeWindowsPrinter = async (
  printerName: string,
  labelPath: string,
) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        shipmentWindowsPrintScriptPath,
        "-PrinterName",
        printerName,
        "-LabelPath",
        labelPath,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", () => {
      // No-op: the helper script is intentionally quiet on success.
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Windows printer job failed with exit code ${code ?? "unknown"}`));
    });
  });
};

const executeWindowsPrinter = async (
  request: ShipmentPrintRequest,
  _config: PrintAgentConfig,
  acceptedAt: string,
): Promise<ShipmentPrintAgentJob> => {
  if (process.platform !== "win32") {
    throw new Error("WINDOWS_PRINTER shipment jobs require a Windows host running the CorePOS shipment print helper.");
  }

  const windowsPrinterName = request.printer.windowsPrinterName;
  if (!windowsPrinterName) {
    throw new Error("Windows printer name is not configured");
  }

  const jobId = buildJobId();
  const payload = buildPrintableContent(request);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "corepos-zebra-shipment-"));
  const tempPath = path.join(
    tempDir,
    `${slugify(request.orderNumber)}-${slugify(request.trackingNumber)}.zpl`,
  );

  try {
    await fs.writeFile(tempPath, payload, "utf8");
    await invokeWindowsPrinter(windowsPrinterName, tempPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }

  return {
    jobId,
    acceptedAt,
    completedAt: new Date().toISOString(),
    transportMode: "WINDOWS_PRINTER",
    printerId: request.printer.printerId,
    printerKey: request.printer.printerKey,
    printerName: request.printer.printerName,
    printerTarget: windowsPrinterName,
    copies: request.printer.copies,
    documentFormat: SHIPMENT_LABEL_DOCUMENT_FORMAT,
    bytesSent: Buffer.byteLength(payload, "utf8"),
    simulated: false,
    outputPath: null,
  };
};

export const submitShipmentPrintJob = async (
  request: ShipmentPrintRequest,
  config: PrintAgentConfig,
): Promise<ShipmentPrintAgentJob> => {
  if (request.document.format !== SHIPMENT_LABEL_DOCUMENT_FORMAT) {
    throw new Error(`Unsupported label format: ${request.document.format}`);
  }

  const acceptedAt = new Date().toISOString();
  switch (request.printer.transportMode) {
    case "WINDOWS_PRINTER":
      return executeWindowsPrinter(request, config, acceptedAt);
    case "RAW_TCP":
      return executeRawTcp(request, config, acceptedAt);
    case "DRY_RUN":
    default:
      return executeDryRun(request, config, acceptedAt);
  }
};
