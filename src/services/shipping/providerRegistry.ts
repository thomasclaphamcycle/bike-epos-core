import { HttpError } from "../../utils/http";
import type { ShippingLabelProvider } from "./contracts";
import { EasyPostShippingLabelProvider } from "./easyPostProvider";
import { GenericHttpZplShippingProvider } from "./genericHttpZplProvider";
import { InternalMockShippingLabelProvider } from "./mockShippingProvider";

const providers = [
  new InternalMockShippingLabelProvider(),
  new GenericHttpZplShippingProvider(),
  new EasyPostShippingLabelProvider(),
] as const satisfies readonly ShippingLabelProvider[];

const providerMap = new Map(providers.map((provider) => [provider.providerKey, provider]));

export const getShippingLabelProviderOrThrow = (providerKey: string) => {
  const provider = providerMap.get(providerKey);
  if (!provider) {
    throw new HttpError(400, `Unsupported shipping provider: ${providerKey}`, "INVALID_SHIPPING_PROVIDER");
  }

  return provider;
};

export const listSupportedShippingProviders = () =>
  providers.map((provider) => ({
    key: provider.providerKey,
    displayName: provider.providerDisplayName,
    mode: provider.mode,
    implementationState: provider.implementationState,
    requiresConfiguration: provider.requiresConfiguration,
    supportsShipmentRefresh: provider.supportsShipmentRefresh,
    supportsShipmentVoid: provider.supportsShipmentVoid,
    supportedLabelFormats: ["ZPL"] as const,
    defaultServiceCode: provider.providerKey === "EASYPOST" ? "GroundAdvantage" : "STANDARD",
    defaultServiceName: provider.providerKey === "EASYPOST" ? "Ground Advantage" : "Standard Dispatch",
  }));

export const DEFAULT_SHIPPING_PROVIDER_KEY = "INTERNAL_MOCK_ZPL";
export const DEFAULT_SHIPPING_SERVICE_CODE = "STANDARD";
export const DEFAULT_SHIPPING_SERVICE_NAME = "Standard Dispatch";
