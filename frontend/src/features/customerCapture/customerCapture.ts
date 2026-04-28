import { ApiError, apiGet, apiPost } from "../../api/client";
import { getStoredReceiptWorkstationKey } from "../receipts/receiptWorkstation";

export type CaptureSessionStatus = "ACTIVE" | "COMPLETED" | "EXPIRED";
export type CustomerCaptureOwnerType = "sale" | "basket";

export type CustomerCaptureSession = {
  id: string;
  saleId: string | null;
  basketId: string | null;
  station: {
    key: string;
    entryPath: string;
  } | null;
  ownerType: CustomerCaptureOwnerType;
  token: string;
  status: CaptureSessionStatus;
  expiresAt: string;
  createdAt: string;
  completedAt: string | null;
  publicPath: string;
  outcome: {
    matchType: "email" | "phone" | "created";
    customer: {
      id: string;
      name: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
    };
  } | null;
};

export type CurrentCustomerCaptureSessionResponse = {
  session: CustomerCaptureSession | null;
};

export type CreateCustomerCaptureSessionResponse = {
  session: CustomerCaptureSession;
  replacedActiveSessionCount: number;
};

export type PublicCustomerCaptureSessionState = {
  session: {
    status: CaptureSessionStatus;
    expiresAt: string;
    createdAt: string;
    completedAt: string | null;
    isReplaced: boolean;
    ownerType: CustomerCaptureOwnerType;
  };
};

export type PublicCustomerCaptureStationEntryResponse = {
  station: {
    key: string;
    entryPath: string;
  } | null;
  session: {
    token: string;
    ownerType: CustomerCaptureOwnerType;
    publicPath: string;
    expiresAt: string;
    createdAt: string;
  } | null;
};

export type PublicCustomerCaptureSubmitResponse = {
  session: {
    status: "COMPLETED";
    expiresAt: string;
    completedAt: string | null;
    isReplaced: boolean;
    ownerType: CustomerCaptureOwnerType;
  };
  customer: {
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };
  sale: {
    id: string;
  } | null;
  basket: {
    id: string;
  } | null;
  matchType: "email" | "phone" | "created";
};

export type PublicCustomerCaptureMatchPreviewResponse = {
  preview: {
    matchType: "email" | "phone" | "created";
    willUseExistingCustomer: boolean;
    existingDetailsRetained: boolean;
    emailProvided: boolean;
    phoneProvided: boolean;
    emailMatched: boolean;
    phoneMatched: boolean;
    conflictingMatch: boolean;
    precedence: Array<"email" | "phone">;
  };
};

export const getPublicAppOrigin = () => {
  const configuredOrigin = import.meta.env.VITE_PUBLIC_APP_ORIGIN?.trim();
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://localhost:4173";
};

export const buildCustomerCaptureEntryUrl = (token: string) =>
  `${getPublicAppOrigin()}/customer-capture?token=${encodeURIComponent(token)}`;

const DEFAULT_CUSTOMER_CAPTURE_STATION_KEY = "TILL_PC";

const getCurrentCustomerCaptureStationKey = () => (
  getStoredReceiptWorkstationKey() ?? DEFAULT_CUSTOMER_CAPTURE_STATION_KEY
);

export const getCurrentSaleCustomerCaptureSession = (saleId: string) =>
  apiGet<CurrentCustomerCaptureSessionResponse>(
    `/api/sales/${encodeURIComponent(saleId)}/customer-capture-sessions/current`,
  );

export const createSaleCustomerCaptureSession = (saleId: string) =>
  apiPost<CreateCustomerCaptureSessionResponse>(
    `/api/sales/${encodeURIComponent(saleId)}/customer-capture-sessions`,
    {
      stationKey: getCurrentCustomerCaptureStationKey(),
    },
  );

export const getCurrentBasketCustomerCaptureSession = (basketId: string) =>
  apiGet<CurrentCustomerCaptureSessionResponse>(
    `/api/baskets/${encodeURIComponent(basketId)}/customer-capture-sessions/current`,
  );

export const createBasketCustomerCaptureSession = (basketId: string) =>
  apiPost<CreateCustomerCaptureSessionResponse>(
    `/api/baskets/${encodeURIComponent(basketId)}/customer-capture-sessions`,
    {
      stationKey: getCurrentCustomerCaptureStationKey(),
    },
  );

export const getPublicCustomerCaptureStationEntry = (station: string) =>
  apiGet<PublicCustomerCaptureStationEntryResponse>(
    `/api/public/customer-capture/entry/${encodeURIComponent(station)}`,
  );

export const getPublicSaleCustomerCaptureSession = (token: string) =>
  apiGet<PublicCustomerCaptureSessionState>(
    `/api/public/customer-capture/${encodeURIComponent(token)}`,
  );

export const submitPublicSaleCustomerCapture = (
  token: string,
  body: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
  },
) =>
  apiPost<PublicCustomerCaptureSubmitResponse>(
    `/api/public/customer-capture/${encodeURIComponent(token)}`,
    body,
  );

export const previewPublicSaleCustomerCaptureMatch = (
  token: string,
  body: {
    email?: string;
    phone?: string;
  },
) =>
  apiPost<PublicCustomerCaptureMatchPreviewResponse>(
    `/api/public/customer-capture/${encodeURIComponent(token)}/preview`,
    body,
  );

const getApiErrorCode = (error: unknown) => {
  if (!(error instanceof ApiError) || !error.payload || typeof error.payload !== "object") {
    return null;
  }

  const payload = error.payload as { error?: { code?: unknown } };
  return typeof payload.error?.code === "string" ? payload.error.code : null;
};

export const getCustomerCapturePublicPageErrorMessage = (error: unknown) => {
  const code = getApiErrorCode(error);

  switch (code) {
    case "CUSTOMER_CAPTURE_NOT_FOUND":
      return "This customer capture link is not valid.";
    case "CUSTOMER_CAPTURE_EXPIRED":
      return "This customer capture link has expired. Please ask staff for a new one.";
    case "CUSTOMER_CAPTURE_REPLACED":
      return "This link has been replaced by a newer one. Please ask staff for the latest customer link.";
    case "CUSTOMER_CAPTURE_STATION_NOT_FOUND":
      return "This tap point is not configured yet.";
    case "CUSTOMER_CAPTURE_COMPLETED":
      return "This customer capture link has already been used.";
    case "INVALID_CUSTOMER_CAPTURE":
      return "Please enter first name, last name, and at least one contact method.";
    default:
      return error instanceof Error
        ? error.message
        : "We could not load the customer capture link.";
  }
};
