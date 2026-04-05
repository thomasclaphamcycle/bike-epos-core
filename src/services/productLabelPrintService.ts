import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ProductLabelPrintAgentJob, ProductLabelPrintRequest } from "../../shared/productLabelPrintContract";
import {
  DYMO_57X32_MODEL_HINT,
  DYMO_LABEL_PRINTER_FAMILY,
  PRODUCT_LABEL_PRINT_INTENT,
  PRODUCT_LABEL_PRINT_REQUEST_VERSION,
  PRODUCT_LABEL_WINDOWS_LOCAL_AGENT_TRANSPORT,
} from "../../shared/productLabelPrintContract";
import { renderProductLabelDocument, type ProductLabelRenderInput } from "../../shared/productLabelDocument";
import { logOperationalEvent } from "../lib/operationalLogger";
import { HttpError } from "../utils/http";
import { listStoreInfoSettings } from "./configurationService";
import { getVariantById } from "./productService";
import {
  resolveProductLabelPrinterSelection,
  type ResolvedProductLabelPrinter,
  type ResolvePrinterSelectionInput,
} from "./printerService";
import { deliverProductLabelPrintRequestToAgent } from "./productLabelPrintAgentDeliveryService";

const MAX_PRODUCT_LABEL_COPIES = 20;
const PRODUCT_LABEL_LOGO_TIMEOUT_MS = 3000;
const PRODUCT_LABEL_LOGO_MAX_BYTES = 1024 * 1024;
const DEFAULT_PRODUCT_LABEL_LOGO_PATH = path.join(
  process.cwd(),
  "frontend",
  "src",
  "assets",
  "branding",
  "corepos-logo-light.png",
);

const LOGO_MIME_BY_EXTENSION = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

let defaultProductLabelLogoDataUrlPromise: Promise<string | null> | null = null;

export type ProductLabelDirectPrintInput = ResolvePrinterSelectionInput & {
  copies?: number;
};

export type ProductLabelDirectPrintResponse = {
  variant: Awaited<ReturnType<typeof getVariantById>>;
  printer: ResolvedProductLabelPrinter;
  printJob: ProductLabelPrintAgentJob;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "product-label";

const normalizeCopies = (value: unknown) => {
  if (value === undefined || value === null) {
    return 1;
  }
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > MAX_PRODUCT_LABEL_COPIES) {
    throw new HttpError(
      400,
      `copies must be an integer between 1 and ${MAX_PRODUCT_LABEL_COPIES}`,
      "INVALID_PRODUCT_LABEL_PRINT",
    );
  }

  return Number(value);
};

const normalizeLogoBufferToDataUrl = (buffer: Buffer, mimeType: string) => {
  if (buffer.byteLength === 0 || buffer.byteLength > PRODUCT_LABEL_LOGO_MAX_BYTES) {
    return null;
  }

  return `data:${mimeType};base64,${buffer.toString("base64")}`;
};

const resolveLocalStoreLogoDataUrl = async (logoPath: string) => {
  if (!logoPath.startsWith("/uploads/store-logos/")) {
    return null;
  }

  const normalizedRelativePath = logoPath.replace(/^\/+/, "");
  const extension = path.extname(normalizedRelativePath).toLowerCase();
  const mimeType = LOGO_MIME_BY_EXTENSION.get(extension);
  if (!mimeType) {
    return null;
  }

  try {
    const buffer = await fs.readFile(path.join(process.cwd(), normalizedRelativePath));
    return normalizeLogoBufferToDataUrl(buffer, mimeType);
  } catch {
    return null;
  }
};

const resolveRemoteStoreLogoDataUrl = async (logoUrl: string) => {
  try {
    const response = await fetch(logoUrl, {
      signal: AbortSignal.timeout(PRODUCT_LABEL_LOGO_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!LOGO_MIME_BY_EXTENSION.has(path.extname(new URL(logoUrl).pathname).toLowerCase())
      && !Array.from(LOGO_MIME_BY_EXTENSION.values()).includes(contentType)) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return normalizeLogoBufferToDataUrl(buffer, contentType || "image/png");
  } catch {
    return null;
  }
};

const resolveProductLabelLogoDataUrl = async (preferredLogoUrl: string | null | undefined) => {
  const trimmed = preferredLogoUrl?.trim() ?? "";
  if (!trimmed) {
    if (!defaultProductLabelLogoDataUrlPromise) {
      defaultProductLabelLogoDataUrlPromise = fs
        .readFile(DEFAULT_PRODUCT_LABEL_LOGO_PATH)
        .then((buffer) => normalizeLogoBufferToDataUrl(buffer, "image/png"))
        .catch(() => null);
    }
    return defaultProductLabelLogoDataUrlPromise;
  }

  if (trimmed.startsWith("/uploads/store-logos/")) {
    return (await resolveLocalStoreLogoDataUrl(trimmed))
      ?? (defaultProductLabelLogoDataUrlPromise
        ??= fs.readFile(DEFAULT_PRODUCT_LABEL_LOGO_PATH)
          .then((buffer) => normalizeLogoBufferToDataUrl(buffer, "image/png"))
          .catch(() => null));
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return (await resolveRemoteStoreLogoDataUrl(trimmed))
      ?? (defaultProductLabelLogoDataUrlPromise
        ??= fs.readFile(DEFAULT_PRODUCT_LABEL_LOGO_PATH)
          .then((buffer) => normalizeLogoBufferToDataUrl(buffer, "image/png"))
          .catch(() => null));
  }

  if (!defaultProductLabelLogoDataUrlPromise) {
    defaultProductLabelLogoDataUrlPromise = fs
      .readFile(DEFAULT_PRODUCT_LABEL_LOGO_PATH)
      .then((buffer) => normalizeLogoBufferToDataUrl(buffer, "image/png"))
      .catch(() => null);
  }
  return defaultProductLabelLogoDataUrlPromise;
};

const buildProductLabelPrintRequest = async (
  variantId: string,
  input: ProductLabelDirectPrintInput,
): Promise<{ variant: Awaited<ReturnType<typeof getVariantById>>; printer: ResolvedProductLabelPrinter; printRequest: ProductLabelPrintRequest }> => {
  const [variant, store, printer] = await Promise.all([
    getVariantById(variantId),
    listStoreInfoSettings(),
    resolveProductLabelPrinterSelection(input),
  ]);

  const copies = normalizeCopies(input.copies);
  const shopName = store.businessName || store.name || "CorePOS";
  const variantName = variant.name || variant.option || null;
  const logoDataUrl = await resolveProductLabelLogoDataUrl(store.preferredLogoUrl);
  const label = {
    shopName,
    productName: variant.product?.name || variant.sku,
    variantName,
    brand: variant.product?.brand || null,
    sku: variant.sku,
    pricePence: variant.retailPricePence,
    barcode: variant.barcode,
  };
  const renderedDocument = renderProductLabelDocument({
    ...label,
    logoDataUrl,
  } satisfies ProductLabelRenderInput);

  return {
    variant,
    printer,
    printRequest: {
      version: PRODUCT_LABEL_PRINT_REQUEST_VERSION,
      intentType: PRODUCT_LABEL_PRINT_INTENT,
      variantId: variant.id,
      printer: {
        transport: PRODUCT_LABEL_WINDOWS_LOCAL_AGENT_TRANSPORT,
        printerId: printer.id,
        printerKey: printer.key,
        printerFamily: DYMO_LABEL_PRINTER_FAMILY,
        printerModelHint: DYMO_57X32_MODEL_HINT,
        printerName: printer.name,
        transportMode: printer.transportMode,
        windowsPrinterName: printer.windowsPrinterName,
        copies,
      },
      label,
      document: {
        format: renderedDocument.imageFormat,
        mimeType: renderedDocument.mimeType,
        fileName: `${slugify(variant.product?.name || variant.sku)}-${slugify(variant.sku)}.${renderedDocument.extension}`,
        bytesBase64: renderedDocument.buffer.toString("base64"),
        widthPx: renderedDocument.widthPx,
        heightPx: renderedDocument.heightPx,
      },
      metadata: {
        source: "COREPOS_PRODUCT_LABEL_PAGE",
        sourceLabel: variant.sku,
      },
    },
  };
};

export const printProductLabelDirect = async (
  variantId: string,
  input: ProductLabelDirectPrintInput = {},
): Promise<ProductLabelDirectPrintResponse> => {
  const prepared = await buildProductLabelPrintRequest(variantId, input);

  try {
    const printAgentResponse = await deliverProductLabelPrintRequestToAgent(prepared.printRequest);

    logOperationalEvent("product_label.direct_print.completed", {
      entityId: prepared.variant.id,
      variantId: prepared.variant.id,
      sku: prepared.variant.sku,
      printerId: prepared.printer.id,
      printerKey: prepared.printer.key,
      printerTransportMode: prepared.printer.transportMode,
      printJobId: printAgentResponse.job.jobId,
      simulated: printAgentResponse.job.simulated,
    });

    return {
      variant: prepared.variant,
      printer: prepared.printer,
      printJob: printAgentResponse.job,
    };
  } catch (error) {
    logOperationalEvent("product_label.direct_print.failed", {
      entityId: prepared.variant.id,
      variantId: prepared.variant.id,
      sku: prepared.variant.sku,
      printerId: prepared.printer.id,
      printerKey: prepared.printer.key,
      printerTransportMode: prepared.printer.transportMode,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
