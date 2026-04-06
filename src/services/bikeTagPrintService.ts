import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BikeTagPrintAgentJob, BikeTagPrintRequest } from "../../shared/bikeTagPrintContract";
import {
  BIKE_TAG_PRINT_INTENT,
  BIKE_TAG_PRINT_REQUEST_VERSION,
  BIKE_TAG_WINDOWS_LOCAL_AGENT_TRANSPORT,
  BIKE_TAG_DOCUMENT_FORMAT,
  OFFICE_A5_DOCUMENT_MODEL_HINT,
  OFFICE_DOCUMENT_PRINTER_FAMILY,
} from "../../shared/bikeTagPrintContract";
import { buildBikeTagRenderData } from "../../shared/bikeTagRenderData";
import { renderBikeTagSheetDocument } from "../../shared/bikeTagSheetDocument";
import { logOperationalEvent } from "../lib/operationalLogger";
import { HttpError } from "../utils/http";
import { listStoreInfoSettings } from "./configurationService";
import { getProductById, getVariantById } from "./productService";
import {
  resolveBikeTagPrinterSelection,
  type ResolvePrinterSelectionInput,
  type ResolvedBikeTagPrinter,
} from "./printerService";
import { deliverBikeTagPrintRequestToAgent } from "./bikeTagPrintAgentDeliveryService";

const MAX_BIKE_TAG_COPIES = 20;
const BIKE_TAG_LOGO_TIMEOUT_MS = 3000;
const BIKE_TAG_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_BIKE_TAG_LOGO_PATH = path.join(
  process.cwd(),
  "frontend",
  "src",
  "assets",
  "branding",
  "corepos-logo-horizontal.png",
);

const LOGO_MIME_BY_EXTENSION = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

let defaultBikeTagLogoDataUrlPromise: Promise<string | null> | null = null;

export type BikeTagDirectPrintInput = ResolvePrinterSelectionInput & {
  copies?: number;
};

export type BikeTagDirectPrintResponse = {
  variant: Awaited<ReturnType<typeof getVariantById>>;
  printer: ResolvedBikeTagPrinter;
  printJob: BikeTagPrintAgentJob;
};

export type BikeTagRenderedDocumentResponse = {
  variant: Awaited<ReturnType<typeof getVariantById>>;
  product: Awaited<ReturnType<typeof getProductById>> | null;
  renderedDocument: ReturnType<typeof renderBikeTagSheetDocument>;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "bike-tag";

const normalizeCopies = (value: unknown) => {
  if (value === undefined || value === null) {
    return 1;
  }
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > MAX_BIKE_TAG_COPIES) {
    throw new HttpError(
      400,
      `copies must be an integer between 1 and ${MAX_BIKE_TAG_COPIES}`,
      "INVALID_BIKE_TAG_PRINT",
    );
  }

  return Number(value);
};

const normalizeLogoBufferToDataUrl = (buffer: Buffer, mimeType: string) => {
  if (buffer.byteLength === 0 || buffer.byteLength > BIKE_TAG_LOGO_MAX_BYTES) {
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
      signal: AbortSignal.timeout(BIKE_TAG_LOGO_TIMEOUT_MS),
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

const resolveBikeTagLogoDataUrl = async (preferredLogoUrl: string | null | undefined) => {
  const trimmed = preferredLogoUrl?.trim() ?? "";
  if (!trimmed) {
    if (!defaultBikeTagLogoDataUrlPromise) {
      defaultBikeTagLogoDataUrlPromise = fs
        .readFile(DEFAULT_BIKE_TAG_LOGO_PATH)
        .then((buffer) => normalizeLogoBufferToDataUrl(buffer, "image/png"))
        .catch(() => null);
    }
    return defaultBikeTagLogoDataUrlPromise;
  }

  if (trimmed.startsWith("/uploads/store-logos/")) {
    return (await resolveLocalStoreLogoDataUrl(trimmed))
      ?? (defaultBikeTagLogoDataUrlPromise
        ??= fs.readFile(DEFAULT_BIKE_TAG_LOGO_PATH)
          .then((buffer) => normalizeLogoBufferToDataUrl(buffer, "image/png"))
          .catch(() => null));
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return (await resolveRemoteStoreLogoDataUrl(trimmed))
      ?? (defaultBikeTagLogoDataUrlPromise
        ??= fs.readFile(DEFAULT_BIKE_TAG_LOGO_PATH)
          .then((buffer) => normalizeLogoBufferToDataUrl(buffer, "image/png"))
          .catch(() => null));
  }

  if (!defaultBikeTagLogoDataUrlPromise) {
    defaultBikeTagLogoDataUrlPromise = fs
      .readFile(DEFAULT_BIKE_TAG_LOGO_PATH)
      .then((buffer) => normalizeLogoBufferToDataUrl(buffer, "image/png"))
      .catch(() => null);
  }
  return defaultBikeTagLogoDataUrlPromise;
};

const buildBikeTagPrintRequest = async (
  variantId: string,
  input: BikeTagDirectPrintInput,
): Promise<{
  variant: Awaited<ReturnType<typeof getVariantById>>;
  printer: ResolvedBikeTagPrinter;
  printRequest: BikeTagPrintRequest;
}> => {
  const [{ variant, renderedDocument }, printer] = await Promise.all([
    renderBikeTagDocumentForVariant(variantId),
    resolveBikeTagPrinterSelection(input),
  ]);

  const copies = normalizeCopies(input.copies);

  return {
    variant,
    printer,
    printRequest: {
      version: BIKE_TAG_PRINT_REQUEST_VERSION,
      intentType: BIKE_TAG_PRINT_INTENT,
      variantId: variant.id,
      printer: {
        transport: BIKE_TAG_WINDOWS_LOCAL_AGENT_TRANSPORT,
        printerId: printer.id,
        printerKey: printer.key,
        printerFamily: OFFICE_DOCUMENT_PRINTER_FAMILY,
        printerModelHint: OFFICE_A5_DOCUMENT_MODEL_HINT,
        printerName: printer.name,
        transportMode: printer.transportMode,
        windowsPrinterName: printer.windowsPrinterName,
        copies,
      },
      document: {
        format: BIKE_TAG_DOCUMENT_FORMAT,
        mimeType: renderedDocument.mimeType,
        fileName: `${slugify(variant.product?.name || variant.sku)}-${slugify(variant.sku)}-bike-tag.${renderedDocument.extension}`,
        bytesBase64: renderedDocument.buffer.toString("base64"),
        widthPx: renderedDocument.widthPx,
        heightPx: renderedDocument.heightPx,
      },
      metadata: {
        source: "COREPOS_INVENTORY_BIKE_TAG",
        sourceLabel: variant.sku,
        paperSize: "A5",
        orientation: "LANDSCAPE",
        tagsPerSheet: 2,
      },
    },
  };
};

export const renderBikeTagDocumentForVariant = async (
  variantId: string,
): Promise<BikeTagRenderedDocumentResponse> => {
  const [variant, store] = await Promise.all([
    getVariantById(variantId),
    listStoreInfoSettings(),
  ]);
  const product = variant.productId ? await getProductById(variant.productId).catch(() => null) : null;
  const shopName = store.businessName || store.name || "CorePOS";
  const logoDataUrl = await resolveBikeTagLogoDataUrl(store.preferredLogoUrl);
  const renderData = buildBikeTagRenderData(variant, product);
  const renderedDocument = renderBikeTagSheetDocument({
    shopName,
    logoDataUrl,
    productName: renderData.productName,
    variantLabel: renderData.variantLabel,
    priceLabel: renderData.priceLabel,
    barcodeValue: renderData.barcodeValue,
    specLines: renderData.specLines,
    supportLine: renderData.supportLine,
    sku: variant.sku,
  });

  return {
    variant,
    product,
    renderedDocument,
  };
};

export const printBikeTagDirect = async (
  variantId: string,
  input: BikeTagDirectPrintInput = {},
): Promise<BikeTagDirectPrintResponse> => {
  const prepared = await buildBikeTagPrintRequest(variantId, input);

  try {
    const printAgentResponse = await deliverBikeTagPrintRequestToAgent(prepared.printRequest);

    logOperationalEvent("bike_tag.direct_print.completed", {
      entityId: prepared.variant.id,
      variantId: prepared.variant.id,
      sku: prepared.variant.sku,
      printerId: prepared.printer.id,
      printerKey: prepared.printer.key,
      transportMode: prepared.printer.transportMode,
      copies: prepared.printRequest.printer.copies,
      simulated: printAgentResponse.job.simulated,
    });

    return {
      variant: prepared.variant,
      printer: prepared.printer,
      printJob: printAgentResponse.job,
    };
  } catch (error) {
    logOperationalEvent("bike_tag.direct_print.failed", {
      entityId: prepared.variant.id,
      variantId: prepared.variant.id,
      sku: prepared.variant.sku,
      printerId: prepared.printer.id,
      printerKey: prepared.printer.key,
      transportMode: prepared.printer.transportMode,
      errorCode: error instanceof HttpError ? error.code : undefined,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
