import type { ProductLabelPrintAgentJob, ProductLabelPrintRequest } from "../../shared/productLabelPrintContract";
import {
  DYMO_57X32_MODEL_HINT,
  DYMO_LABEL_PRINTER_FAMILY,
  PRODUCT_LABEL_PRINT_INTENT,
  PRODUCT_LABEL_PRINT_REQUEST_VERSION,
  PRODUCT_LABEL_WINDOWS_LOCAL_AGENT_TRANSPORT,
} from "../../shared/productLabelPrintContract";
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

export type ProductLabelDirectPrintInput = ResolvePrinterSelectionInput & {
  copies?: number;
};

export type ProductLabelDirectPrintResponse = {
  variant: Awaited<ReturnType<typeof getVariantById>>;
  printer: ResolvedProductLabelPrinter;
  printRequest: ProductLabelPrintRequest;
  printJob: ProductLabelPrintAgentJob;
};

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
      label: {
        shopName,
        productName: variant.product?.name || variant.sku,
        variantName,
        brand: variant.product?.brand || null,
        sku: variant.sku,
        pricePence: variant.retailPricePence,
        barcode: variant.barcode,
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
      printRequest: prepared.printRequest,
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
