import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { ReceiptPrintAgentJob, ReceiptPrintRequest } from "../../shared/receiptPrintContract";
import { RECEIPT_DOCUMENT_FORMAT } from "../../shared/receiptPrintContract";
import type { PrintAgentConfig } from "./config";

const buildJobId = () => `receipt-print-job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const receiptWindowsPrintScriptPath = path.resolve(__dirname, "..", "scripts", "print_receipt_windows.ps1");

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "receipt";

const decodeDocumentBytes = (request: ReceiptPrintRequest) => {
  if (request.document.format !== RECEIPT_DOCUMENT_FORMAT) {
    throw new Error(`Unsupported receipt document format: ${request.document.format}`);
  }

  const bytes = Buffer.from(request.document.bytesBase64, "base64");
  if (bytes.length === 0) {
    throw new Error("Receipt document content was empty");
  }
  return bytes;
};

const buildPrintableBytes = (request: ReceiptPrintRequest) => {
  const documentBytes = decodeDocumentBytes(request);
  return Buffer.concat(Array.from({ length: request.printer.copies }, () => documentBytes));
};

const sendRawTcpPayload = async (host: string, port: number, timeoutMs: number, payload: Buffer) => {
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
      finish(new Error(`Raw TCP receipt printer timed out after ${timeoutMs}ms`));
    });

    socket.once("error", (error) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });

    socket.once("connect", () => {
      socket.write(payload, (error) => {
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

const executeDryRun = async (
  request: ReceiptPrintRequest,
  config: PrintAgentConfig,
  acceptedAt: string,
): Promise<ReceiptPrintAgentJob> => {
  const jobId = buildJobId();
  const payload = buildPrintableBytes(request);
  const outputDir = path.join(config.dryRunOutputDir, "receipts");
  const fileName =
    request.document.fileName?.trim()
    || `${new Date().toISOString().replace(/[:.]/g, "-")}-${slugify(request.receiptNumber)}.escpos`;
  const outputPath = path.join(outputDir, fileName);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, payload);

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
    documentFormat: RECEIPT_DOCUMENT_FORMAT,
    bytesSent: payload.length,
    simulated: true,
    outputPath,
  };
};

const executeRawTcp = async (
  request: ReceiptPrintRequest,
  config: PrintAgentConfig,
  acceptedAt: string,
): Promise<ReceiptPrintAgentJob> => {
  const rawTcpHost = request.printer.rawTcpHost;
  if (!rawTcpHost) {
    throw new Error("Raw TCP receipt printer host is not configured");
  }
  const rawTcpPort = request.printer.rawTcpPort;
  if (!rawTcpPort) {
    throw new Error("Raw TCP receipt printer port is not configured");
  }

  const jobId = buildJobId();
  const payload = buildPrintableBytes(request);
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
    documentFormat: RECEIPT_DOCUMENT_FORMAT,
    bytesSent: payload.length,
    simulated: false,
    outputPath: null,
  };
};

const invokeWindowsPrinter = async (
  printerName: string,
  receiptPath: string,
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
        receiptWindowsPrintScriptPath,
        "-PrinterName",
        printerName,
        "-ReceiptPath",
        receiptPath,
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
      // no-op
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Windows printer receipt job failed with exit code ${code ?? "unknown"}`));
    });
  });
};

const executeWindowsPrinter = async (
  request: ReceiptPrintRequest,
  _config: PrintAgentConfig,
  acceptedAt: string,
): Promise<ReceiptPrintAgentJob> => {
  if (process.platform !== "win32") {
    throw new Error("WINDOWS_PRINTER receipt jobs require a Windows host running the CorePOS print agent.");
  }

  const windowsPrinterName = request.printer.windowsPrinterName;
  if (!windowsPrinterName) {
    throw new Error("Windows receipt printer name is not configured");
  }

  const jobId = buildJobId();
  const payload = buildPrintableBytes(request);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "corepos-thermal-receipt-"));
  const tempPath = path.join(tempDir, `${slugify(request.receiptNumber)}.escpos`);

  try {
    await fs.writeFile(tempPath, payload);
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
    documentFormat: RECEIPT_DOCUMENT_FORMAT,
    bytesSent: payload.length,
    simulated: false,
    outputPath: null,
  };
};

export const submitReceiptPrintJob = async (
  request: ReceiptPrintRequest,
  config: PrintAgentConfig,
): Promise<ReceiptPrintAgentJob> => {
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
