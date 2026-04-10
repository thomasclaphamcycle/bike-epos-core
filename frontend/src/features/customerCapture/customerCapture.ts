import { ApiError, apiGet, apiPost } from "../../api/client";

export type CaptureSessionStatus = "ACTIVE" | "COMPLETED" | "EXPIRED";

export type SaleCustomerCaptureSession = {
  id: string;
  saleId: string;
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

export type CurrentSaleCustomerCaptureSessionResponse = {
  session: SaleCustomerCaptureSession | null;
};

export type CreateSaleCustomerCaptureSessionResponse = {
  session: SaleCustomerCaptureSession;
  replacedActiveSessionCount: number;
};

export type PublicSaleCustomerCaptureSessionState = {
  session: {
    status: CaptureSessionStatus;
    expiresAt: string;
    createdAt: string;
    completedAt: string | null;
    isReplaced: boolean;
  };
};

export type PublicSaleCustomerCaptureSubmitResponse = {
  session: {
    status: "COMPLETED";
    expiresAt: string;
    completedAt: string | null;
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
  };
  matchType: "email" | "phone" | "created";
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

export const getCurrentSaleCustomerCaptureSession = (saleId: string) =>
  apiGet<CurrentSaleCustomerCaptureSessionResponse>(
    `/api/sales/${encodeURIComponent(saleId)}/customer-capture-sessions/current`,
  );

export const createSaleCustomerCaptureSession = (saleId: string) =>
  apiPost<CreateSaleCustomerCaptureSessionResponse>(
    `/api/sales/${encodeURIComponent(saleId)}/customer-capture-sessions`,
    {},
  );

export const getPublicSaleCustomerCaptureSession = (token: string) =>
  apiGet<PublicSaleCustomerCaptureSessionState>(
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
  apiPost<PublicSaleCustomerCaptureSubmitResponse>(
    `/api/public/customer-capture/${encodeURIComponent(token)}`,
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
      return "This link has been replaced by a newer one. Please ask staff for the latest QR code or link.";
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
