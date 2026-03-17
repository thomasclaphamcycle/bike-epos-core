import { useNavigate, type NavigateOptions } from "react-router-dom";

export type SaleContext =
  | { type: "RETAIL" }
  | {
      type: "WORKSHOP";
      jobId: string;
      customerName: string;
      bikeLabel?: string;
      depositPaidPence?: number;
    };

export type PosLineItemType = "PART" | "LABOUR";

export type PosLineItem = {
  variantId: string | null;
  type?: PosLineItemType;
  sku: string | null;
  productName: string;
  variantName?: string | null;
  quantity: number;
  unitPricePence: number;
  lineTotalPence: number;
};

export type PosOpenState = {
  saleContext: SaleContext;
  items: PosLineItem[];
  customerId?: string | null;
};

type PosRouteState = {
  posOpenState?: PosOpenState;
};

export const DEFAULT_SALE_CONTEXT: SaleContext = { type: "RETAIL" };

export const resolvePosLineItemType = (item: Pick<PosLineItem, "type">): PosLineItemType =>
  item.type ?? "PART";

export const getPosOpenState = (state: unknown): PosOpenState | null => {
  if (!state || typeof state !== "object") {
    return null;
  }

  const posState = (state as PosRouteState).posOpenState;
  return posState && typeof posState === "object" ? posState : null;
};

type OpenPosOptions = {
  basketId?: string;
  saleId?: string;
  customerId?: string | null;
  navigateOptions?: NavigateOptions;
};

export const useOpenPosWithContext = () => {
  const navigate = useNavigate();

  return (
    context: SaleContext,
    items: PosLineItem[],
    options: OpenPosOptions = {},
  ) => {
    const params = new URLSearchParams();
    if (options.saleId) {
      params.set("saleId", options.saleId);
    } else if (options.basketId) {
      params.set("basketId", options.basketId);
    }

    navigate(
      params.size > 0 ? `/pos?${params.toString()}` : "/pos",
      {
        ...(options.navigateOptions ?? {}),
        state: {
          posOpenState: {
            saleContext: context,
            items,
            customerId: options.customerId,
          },
        },
      },
    );
  };
};
