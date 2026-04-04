import { HttpError } from "../../utils/http";
import type {
  ShippingLabelDocument,
  ShippingLabelGenerationInput,
  ShippingLabelProvider,
  ShippingLabelProviderExecutionContext,
  ShippingLabelProviderResult,
  ShippingPartyAddress,
  ShippingProviderEnvironment,
} from "./contracts";

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_EASYPOST_API_BASE_URL = "https://api.easypost.com/v2";

const COUNTRY_ALIASES = new Map<string, string>([
  ["UK", "GB"],
  ["GB", "GB"],
  ["UNITED KINGDOM", "GB"],
  ["GREAT BRITAIN", "GB"],
  ["ENGLAND", "GB"],
  ["SCOTLAND", "GB"],
  ["WALES", "GB"],
  ["NORTHERN IRELAND", "GB"],
  ["US", "US"],
  ["USA", "US"],
  ["UNITED STATES", "US"],
  ["UNITED STATES OF AMERICA", "US"],
  ["CANADA", "CA"],
  ["AUSTRALIA", "AU"],
  ["IRELAND", "IE"],
  ["FRANCE", "FR"],
  ["GERMANY", "DE"],
  ["SPAIN", "ES"],
  ["ITALY", "IT"],
  ["NETHERLANDS", "NL"],
  ["BELGIUM", "BE"],
  ["DENMARK", "DK"],
  ["SWEDEN", "SE"],
  ["NORWAY", "NO"],
  ["SWITZERLAND", "CH"],
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const expectRecord = (value: unknown, field: string) => {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }

  return value;
};

const expectOptionalRecord = (value: unknown, field: string) => {
  if (value === undefined || value === null) {
    return null;
  }

  return expectRecord(value, field);
};

const expectString = (value: unknown, field: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }

  return value.trim();
};

const expectOptionalString = (value: unknown, field: string) => {
  if (value === undefined || value === null) {
    return null;
  }

  return expectString(value, field);
};

const expectPositiveNumber = (value: unknown, field: string) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive number`);
  }

  return value;
};

const expectEnvironment = (value: unknown): ShippingProviderEnvironment => {
  if (value !== "SANDBOX" && value !== "LIVE") {
    throw new HttpError(
      500,
      "EasyPost provider requires environment SANDBOX or LIVE",
      "INVALID_SHIPPING_PROVIDER_CONFIG",
    );
  }

  return value;
};

const parseJsonResponse = async (response: Response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("EasyPost response was not valid JSON");
  }
};

const extractProviderErrorMessage = (status: number, payload: unknown) => {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload;
  }

  if (isRecord(payload)) {
    const errorValue = payload.error;
    if (typeof errorValue === "string" && errorValue.trim().length > 0) {
      return errorValue;
    }
    if (isRecord(errorValue)) {
      const errorMessage = errorValue.message;
      if (typeof errorMessage === "string" && errorMessage.trim().length > 0) {
        return errorMessage;
      }

      const nestedErrors = errorValue.errors;
      if (Array.isArray(nestedErrors) && nestedErrors.length > 0) {
        const message = nestedErrors
          .map((item) => {
            if (!isRecord(item)) {
              return null;
            }
            const field = typeof item.field === "string" ? item.field.trim() : "";
            const itemMessage = typeof item.message === "string" ? item.message.trim() : "";
            if (!field && !itemMessage) {
              return null;
            }
            return field && itemMessage ? `${field}: ${itemMessage}` : field || itemMessage;
          })
          .filter(Boolean)
          .join("; ");
        if (message) {
          return message;
        }
      }
    }

    const payloadMessage = payload.message;
    if (typeof payloadMessage === "string" && payloadMessage.trim().length > 0) {
      return payloadMessage;
    }
  }

  return `EasyPost rejected the shipment request (${status})`;
};

const normalizeToken = (value: string) => value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

const normalizeCountry = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "GB";
  }

  const alias = COUNTRY_ALIASES.get(trimmed.toUpperCase());
  if (alias) {
    return alias;
  }

  return trimmed.length === 2 ? trimmed.toUpperCase() : trimmed;
};

const buildBasicAuthHeader = (apiKey: string) =>
  `Basic ${Buffer.from(`${apiKey}:`, "utf8").toString("base64")}`;

const buildLabelFileName = (input: ShippingLabelGenerationInput, trackingNumber: string) => {
  const orderToken = normalizeToken(input.order.orderNumber).slice(-16) || "ORDER";
  const trackingToken = normalizeToken(trackingNumber).slice(-20) || "TRACKING";
  return `shipment-${orderToken}-${trackingToken}.zpl`;
};

const buildShipmentReference = (input: ShippingLabelGenerationInput) =>
  `${input.order.orderNumber} / ${input.shipment.shipmentNumber}`;

const resolveRuntimeConfig = (context: ShippingLabelProviderExecutionContext) => {
  const runtimeConfig = context.runtimeConfig;
  if (!runtimeConfig) {
    throw new HttpError(503, "EasyPost provider is not configured", "SHIPPING_PROVIDER_NOT_CONFIGURED");
  }

  const apiKey = expectString(runtimeConfig.apiKey, "runtimeConfig.apiKey");
  const carrierAccountId = expectString(runtimeConfig.carrierAccountId, "runtimeConfig.carrierAccountId");
  const environment = expectEnvironment(runtimeConfig.environment);
  const parcelWeightOz = expectPositiveNumber(runtimeConfig.parcelWeightOz, "runtimeConfig.parcelWeightOz");
  const parcelLengthIn = expectPositiveNumber(runtimeConfig.parcelLengthIn, "runtimeConfig.parcelLengthIn");
  const parcelWidthIn = expectPositiveNumber(runtimeConfig.parcelWidthIn, "runtimeConfig.parcelWidthIn");
  const parcelHeightIn = expectPositiveNumber(runtimeConfig.parcelHeightIn, "runtimeConfig.parcelHeightIn");

  const apiBaseUrl = runtimeConfig.apiBaseUrl?.trim() || DEFAULT_EASYPOST_API_BASE_URL;
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(apiBaseUrl);
  } catch {
    throw new HttpError(
      500,
      "EasyPost apiBaseUrl must be a valid URL",
      "INVALID_SHIPPING_PROVIDER_CONFIG",
    );
  }

  if (parsedBaseUrl.protocol !== "http:" && parsedBaseUrl.protocol !== "https:") {
    throw new HttpError(
      500,
      "EasyPost apiBaseUrl must start with http:// or https://",
      "INVALID_SHIPPING_PROVIDER_CONFIG",
    );
  }

  return {
    apiBaseUrl: parsedBaseUrl.toString().replace(/\/$/, ""),
    apiKey,
    carrierAccountId,
    environment,
    parcelWeightOz,
    parcelLengthIn,
    parcelWidthIn,
    parcelHeightIn,
  };
};

const toEasyPostAddress = (party: ShippingPartyAddress, field: string) => {
  const name = expectString(party.name, `${field}.name`);
  const street1 = expectString(party.addressLine1, `${field}.addressLine1`);
  const city = expectString(party.city, `${field}.city`);
  const zip = expectString(party.postcode, `${field}.postcode`);
  const country = normalizeCountry(expectString(party.country, `${field}.country`));

  return {
    name,
    street1,
    ...(party.addressLine2?.trim() ? { street2: party.addressLine2.trim() } : {}),
    city,
    ...(party.region?.trim() ? { state: party.region.trim() } : {}),
    zip,
    country,
    ...(party.phone?.trim() ? { phone: party.phone.trim() } : {}),
    ...(party.email?.trim() ? { email: party.email.trim().toLowerCase() } : {}),
  };
};

type EasyPostRate = {
  id: string;
  service: string;
  carrier: string | null;
  carrierAccountId: string | null;
  rate: string | null;
  currency: string | null;
};

type EasyPostShipmentResponse = {
  id: string;
  mode: string | null;
  status: string | null;
  trackingCode: string | null;
  rates: EasyPostRate[];
  selectedRate: EasyPostRate | null;
  trackerId: string | null;
  trackerStatus: string | null;
  postageLabel: {
    id: string | null;
    labelFileType: string | null;
    labelUrl: string | null;
    labelZplUrl: string | null;
    labelSize: string | null;
  } | null;
};

const parseEasyPostRate = (value: unknown, field: string): EasyPostRate => {
  const record = expectRecord(value, field);

  return {
    id: expectString(record.id, `${field}.id`),
    service: expectString(record.service, `${field}.service`),
    carrier: expectOptionalString(record.carrier, `${field}.carrier`),
    carrierAccountId: expectOptionalString(record.carrier_account_id, `${field}.carrier_account_id`),
    rate: expectOptionalString(record.rate, `${field}.rate`),
    currency: expectOptionalString(record.currency, `${field}.currency`),
  };
};

const parseEasyPostShipmentResponse = (value: unknown): EasyPostShipmentResponse => {
  const record = expectRecord(value, "response");
  const trackerRecord = expectOptionalRecord(record.tracker, "response.tracker");
  const postageLabelRecord = expectOptionalRecord(record.postage_label, "response.postage_label");

  const rates = Array.isArray(record.rates)
    ? record.rates.map((rate, index) => parseEasyPostRate(rate, `response.rates[${index}]`))
    : [];

  return {
    id: expectString(record.id, "response.id"),
    mode: expectOptionalString(record.mode, "response.mode"),
    status: expectOptionalString(record.status, "response.status"),
    trackingCode: expectOptionalString(record.tracking_code, "response.tracking_code"),
    rates,
    selectedRate: record.selected_rate ? parseEasyPostRate(record.selected_rate, "response.selected_rate") : null,
    trackerId: trackerRecord ? expectOptionalString(trackerRecord.id, "response.tracker.id") : null,
    trackerStatus: trackerRecord ? expectOptionalString(trackerRecord.status, "response.tracker.status") : null,
    postageLabel: postageLabelRecord
      ? {
          id: expectOptionalString(postageLabelRecord.id, "response.postage_label.id"),
          labelFileType: expectOptionalString(postageLabelRecord.label_file_type, "response.postage_label.label_file_type"),
          labelUrl: expectOptionalString(postageLabelRecord.label_url, "response.postage_label.label_url"),
          labelZplUrl: expectOptionalString(postageLabelRecord.label_zpl_url, "response.postage_label.label_zpl_url"),
          labelSize: expectOptionalString(postageLabelRecord.label_size, "response.postage_label.label_size"),
        }
      : null,
  };
};

const findRequestedRate = (
  shipment: EasyPostShipmentResponse,
  serviceCode: string,
  carrierAccountId: string,
) => {
  const normalizedRequestedService = normalizeToken(serviceCode);
  const matchingRate = shipment.rates.find((rate) =>
    normalizeToken(rate.service) === normalizedRequestedService
    && (!rate.carrierAccountId || rate.carrierAccountId === carrierAccountId),
  );

  if (!matchingRate) {
    const availableServices = shipment.rates
      .map((rate) => rate.service)
      .filter((service, index, values) => values.indexOf(service) === index)
      .join(", ");
    throw new HttpError(
      502,
      availableServices
        ? `EasyPost did not return a rate for service ${serviceCode}. Available services: ${availableServices}`
        : `EasyPost did not return any purchasable rates for service ${serviceCode}`,
      "SHIPPING_PROVIDER_REJECTED",
    );
  }

  return matchingRate;
};

const fetchZplDocument = async (
  url: string,
  controller: AbortController,
): Promise<string> => {
  const response = await fetch(url, { signal: controller.signal });
  const content = await response.text();
  if (!response.ok) {
    throw new HttpError(
      502,
      content.trim() || `Failed to download EasyPost ZPL label (${response.status})`,
      "SHIPPING_PROVIDER_REJECTED",
    );
  }
  if (!content.trim()) {
    throw new HttpError(502, "EasyPost returned an empty ZPL label document", "SHIPPING_PROVIDER_INVALID_RESPONSE");
  }
  return content;
};

const requestJson = async (
  url: string,
  init: RequestInit,
  controller: AbortController,
) => {
  const response = await fetch(url, {
    ...init,
    signal: controller.signal,
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new HttpError(
      502,
      extractProviderErrorMessage(response.status, payload),
      "SHIPPING_PROVIDER_REJECTED",
    );
  }

  return payload;
};

const toProviderStatus = (shipment: EasyPostShipmentResponse) => {
  const rawStatus = shipment.trackerStatus ?? shipment.status ?? null;
  if (!rawStatus) {
    return null;
  }

  return rawStatus.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || null;
};

export class EasyPostShippingLabelProvider implements ShippingLabelProvider {
  readonly providerKey = "EASYPOST";
  readonly providerDisplayName = "EasyPost";
  readonly mode = "integration" as const;
  readonly implementationState = "live" as const;
  readonly requiresConfiguration = true;

  async createLabel(
    input: ShippingLabelGenerationInput,
    context: ShippingLabelProviderExecutionContext,
  ): Promise<ShippingLabelProviderResult> {
    const config = resolveRuntimeConfig(context);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const authorization = buildBasicAuthHeader(config.apiKey);

    try {
      const createPayload = await requestJson(
        `${config.apiBaseUrl}/shipments`,
        {
          method: "POST",
          headers: {
            Authorization: authorization,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            shipment: {
              reference: buildShipmentReference(input),
              to_address: toEasyPostAddress(input.order.shippingRecipient, "order.shippingRecipient"),
              from_address: toEasyPostAddress(input.shipFrom, "shipFrom"),
              parcel: {
                weight: config.parcelWeightOz,
                length: config.parcelLengthIn,
                width: config.parcelWidthIn,
                height: config.parcelHeightIn,
              },
              carrier_accounts: [config.carrierAccountId],
              options: {
                label_format: "ZPL",
                label_size: "4x6",
                print_custom_1: input.order.orderNumber,
                print_custom_2: input.shipment.serviceName,
              },
            },
          }),
        },
        controller,
      );

      const createdShipment = parseEasyPostShipmentResponse(createPayload);
      const selectedRate = findRequestedRate(createdShipment, input.shipment.serviceCode, config.carrierAccountId);

      const buyPayload = await requestJson(
        `${config.apiBaseUrl}/shipments/${encodeURIComponent(createdShipment.id)}/buy`,
        {
          method: "POST",
          headers: {
            Authorization: authorization,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rate: {
              id: selectedRate.id,
            },
          }),
        },
        controller,
      );

      let purchasedShipment = parseEasyPostShipmentResponse(buyPayload);
      let labelZplUrl = purchasedShipment.postageLabel?.labelZplUrl ?? null;
      let usedLabelConversion = false;

      if (!labelZplUrl) {
        if (purchasedShipment.postageLabel?.labelFileType !== "image/png") {
          throw new HttpError(
            502,
            "EasyPost did not return a ZPL label and the purchased label was not convertible from PNG",
            "SHIPPING_PROVIDER_INVALID_RESPONSE",
          );
        }

        const convertedPayload = await requestJson(
          `${config.apiBaseUrl}/shipments/${encodeURIComponent(purchasedShipment.id)}/label?file_format=ZPL`,
          {
            method: "GET",
            headers: {
              Authorization: authorization,
            },
          },
          controller,
        );
        purchasedShipment = parseEasyPostShipmentResponse(convertedPayload);
        labelZplUrl = purchasedShipment.postageLabel?.labelZplUrl ?? null;
        usedLabelConversion = true;
      }

      if (!labelZplUrl) {
        throw new HttpError(
          502,
          "EasyPost did not provide a ZPL label URL after purchase",
          "SHIPPING_PROVIDER_INVALID_RESPONSE",
        );
      }

      const trackingNumber = purchasedShipment.trackingCode;
      if (!trackingNumber) {
        throw new HttpError(502, "EasyPost did not return a tracking number", "SHIPPING_PROVIDER_INVALID_RESPONSE");
      }

      const labelContent = await fetchZplDocument(labelZplUrl, controller);
      const finalRate = purchasedShipment.selectedRate ?? selectedRate;
      const labelReference = purchasedShipment.postageLabel?.id ?? labelZplUrl;
      const trackerId = purchasedShipment.trackerId;

      const document: ShippingLabelDocument = {
        format: "ZPL",
        mimeType: "application/zpl",
        fileName: buildLabelFileName(input, trackingNumber),
        content: labelContent,
      };

      return {
        trackingNumber,
        normalizedServiceCode: finalRate.service,
        normalizedServiceName: finalRate.service,
        providerReference: purchasedShipment.id,
        providerShipmentReference: purchasedShipment.id,
        providerTrackingReference: trackerId ?? trackingNumber,
        providerLabelReference: labelReference,
        providerStatus: toProviderStatus(purchasedShipment),
        providerMetadata: {
          adapterKey: this.providerKey,
          environment: config.environment,
          easyPostMode: purchasedShipment.mode,
          easyPostShipmentId: purchasedShipment.id,
          easyPostTrackerId: trackerId,
          easyPostLabelId: purchasedShipment.postageLabel?.id ?? null,
          selectedRateId: finalRate.id,
          selectedRateCarrier: finalRate.carrier,
          selectedRateCarrierAccountId: finalRate.carrierAccountId,
          selectedRateService: finalRate.service,
          selectedRateAmount: finalRate.rate,
          selectedRateCurrency: finalRate.currency,
          labelFileType: purchasedShipment.postageLabel?.labelFileType ?? null,
          labelSize: purchasedShipment.postageLabel?.labelSize ?? null,
          labelConvertedFromPng: usedLabelConversion,
        },
        document,
      };
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
        throw new HttpError(
          504,
          `EasyPost timed out after ${DEFAULT_TIMEOUT_MS}ms`,
          "SHIPPING_PROVIDER_TIMEOUT",
        );
      }

      throw new HttpError(
        503,
        error instanceof Error ? `EasyPost could not be reached: ${error.message}` : "EasyPost could not be reached",
        "SHIPPING_PROVIDER_UNREACHABLE",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
