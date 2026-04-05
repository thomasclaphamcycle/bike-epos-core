import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProductLabelPrintAgentJob, ProductLabelPrintRequest } from "../../shared/productLabelPrintContract";
import {
  PRODUCT_LABEL_DOCUMENT_FORMAT,
  PRODUCT_LABEL_RENDER_FORMAT,
} from "../../shared/productLabelPrintContract";
import type { PrintAgentConfig } from "./config";

const LABEL_WIDTH_MM = 57;
const LABEL_HEIGHT_MM = 32;
const WINDOWS_PRINT_SCRIPT_PATH = path.resolve(__dirname, "..", "scripts", "print_product_label_windows.ps1");

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "product-label";

const buildJobId = () => `product-label-job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createTempImagePath = async (fileName: string) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "corepos-dymo-label-"));
  return {
    tempDir,
    imagePath: path.join(tempDir, fileName),
  };
};

const decodeDocumentBytes = (request: ProductLabelPrintRequest) => {
  if (request.document.format !== PRODUCT_LABEL_DOCUMENT_FORMAT) {
    throw new Error(`Unsupported product-label document format: ${request.document.format}`);
  }

  const bytes = Buffer.from(request.document.bytesBase64, "base64");
  if (bytes.length === 0) {
    throw new Error("Product-label document content was empty");
  }

  return bytes;
};

const runWindowsPrinterJob = async (
  printerName: string,
  imagePath: string,
  copies: number,
) => {
  if (process.platform !== "win32") {
    throw new Error("WINDOWS_PRINTER transport is only available on Windows dispatch machines");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        WINDOWS_PRINT_SCRIPT_PATH,
        "-PrinterName",
        printerName,
        "-ImagePath",
        imagePath,
        "-Copies",
        String(copies),
        "-WidthMm",
        String(LABEL_WIDTH_MM),
        "-HeightMm",
        String(LABEL_HEIGHT_MM),
      ],
      {
        windowsHide: true,
      },
    );

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const message = stderr.trim() || stdout.trim() || `PowerShell print command failed with exit code ${code ?? "unknown"}`;
      reject(new Error(message));
    });
  });
};

const executeDryRun = async (
  request: ProductLabelPrintRequest,
  config: PrintAgentConfig,
  acceptedAt: string,
): Promise<ProductLabelPrintAgentJob> => {
  const documentBytes = decodeDocumentBytes(request);
  const jobId = buildJobId();
  const outputDir = path.join(config.dryRunOutputDir, "product-labels");
  const fileName = request.document.fileName?.trim() || `${new Date().toISOString().replace(/[:.]/g, "-")}-${slugify(request.label.productName)}-${slugify(request.label.sku ?? request.variantId)}.png`;
  const outputPath = path.join(outputDir, fileName);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, documentBytes);

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
    documentFormat: PRODUCT_LABEL_RENDER_FORMAT,
    bytesSent: documentBytes.length,
    simulated: true,
    outputPath,
  };
};

const executeWindowsPrinter = async (
  request: ProductLabelPrintRequest,
  acceptedAt: string,
): Promise<ProductLabelPrintAgentJob> => {
  const printerTarget = request.printer.windowsPrinterName?.trim();
  if (!printerTarget) {
    throw new Error("Installed Windows printer name is missing for this Dymo product-label job");
  }

  const documentBytes = decodeDocumentBytes(request);
  const jobId = buildJobId();
  const fileName = request.document.fileName?.trim() || `${slugify(request.label.productName)}-${slugify(request.label.sku ?? request.variantId)}.png`;
  const { tempDir, imagePath } = await createTempImagePath(fileName);

  try {
    await fs.writeFile(imagePath, documentBytes);
    await runWindowsPrinterJob(printerTarget, imagePath, request.printer.copies);
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
    printerTarget,
    copies: request.printer.copies,
    documentFormat: PRODUCT_LABEL_RENDER_FORMAT,
    bytesSent: documentBytes.length,
    simulated: false,
    outputPath: null,
  };
};

export const submitProductLabelPrintJob = async (
  request: ProductLabelPrintRequest,
  config: PrintAgentConfig,
): Promise<ProductLabelPrintAgentJob> => {
  const acceptedAt = new Date().toISOString();

  switch (request.printer.transportMode) {
    case "WINDOWS_PRINTER":
      return executeWindowsPrinter(request, acceptedAt);
    case "DRY_RUN":
    default:
      return executeDryRun(request, config, acceptedAt);
  }
};
