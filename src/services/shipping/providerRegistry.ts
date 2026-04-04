import { HttpError } from "../../utils/http";
import type { ShippingLabelProvider } from "./contracts";
import { InternalMockShippingLabelProvider } from "./mockShippingProvider";

const providers = [
  new InternalMockShippingLabelProvider(),
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
    supportedLabelFormats: ["ZPL"] as const,
    defaultServiceCode: "STANDARD",
    defaultServiceName: "Standard Dispatch",
  }));

export const DEFAULT_SHIPPING_PROVIDER_KEY = "INTERNAL_MOCK_ZPL";
export const DEFAULT_SHIPPING_SERVICE_CODE = "STANDARD";
export const DEFAULT_SHIPPING_SERVICE_NAME = "Standard Dispatch";
