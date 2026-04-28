import type { CustomerCaptureOwnerType, CustomerCaptureSession } from "./customerCapture";

export type PosCustomerCaptureCustomer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

export type PosCustomerCaptureBasket = {
  basket: {
    id: string;
    status: string;
    customer: PosCustomerCaptureCustomer | null;
  };
};

export type PosCustomerCaptureSale = {
  sale: {
    id: string;
    completedAt: string | null;
    customer: PosCustomerCaptureCustomer | null;
  };
};

export type PosCustomerCaptureTarget =
  | {
      ownerType: "basket";
      basket: PosCustomerCaptureBasket["basket"];
    }
  | {
      ownerType: "sale";
      sale: PosCustomerCaptureSale["sale"];
    };

export type CaptureCompletionSummary = {
  ownerType: CustomerCaptureOwnerType;
  ownerId: string;
  sessionId: string;
  customer: PosCustomerCaptureCustomer;
  matchType: "email" | "phone" | "created";
};

export const buildCaptureCompletionSummary = (
  target: PosCustomerCaptureTarget,
  session: CustomerCaptureSession,
): CaptureCompletionSummary | null => {
  if (!session.outcome) {
    return null;
  }

  return {
    ownerType: target.ownerType,
    ownerId: target.ownerType === "sale" ? target.sale.id : target.basket.id,
    sessionId: session.id,
    customer: {
      id: session.outcome.customer.id,
      name: session.outcome.customer.name,
      email: session.outcome.customer.email,
      phone: session.outcome.customer.phone,
    },
    matchType: session.outcome.matchType,
  };
};

export const getCaptureTargetCustomer = (target: PosCustomerCaptureTarget | null) => (
  target?.ownerType === "sale" ? target.sale.customer : target?.basket.customer ?? null
);

export const getCaptureTargetId = (target: PosCustomerCaptureTarget | null) => (
  target?.ownerType === "sale" ? target.sale.id : target?.basket.id ?? null
);

export const getCaptureContextLabel = (ownerType: CustomerCaptureOwnerType) => (
  ownerType === "sale" ? "sale" : "basket"
);

export const formatCaptureMatchOutcome = (
  matchType: "email" | "phone" | "created",
  customerName?: string | null,
) => {
  switch (matchType) {
    case "created":
      return customerName
        ? `Created a new customer profile for ${customerName}.`
        : "Created a new customer profile.";
    case "email":
      return customerName
        ? `Matched existing customer ${customerName} by email.`
        : "Matched an existing customer by email.";
    case "phone":
      return customerName
        ? `Matched existing customer ${customerName} by phone.`
        : "Matched an existing customer by phone.";
    default:
      return "Customer attached.";
  }
};

export const getCaptureOutcomeLabel = (matchType: "email" | "phone" | "created") => {
  switch (matchType) {
    case "created":
      return "New customer";
    case "email":
      return "Matched by email";
    case "phone":
      return "Matched by phone";
    default:
      return "Customer attached";
  }
};

export const formatCustomerContactSummary = (
  customer: { email?: string | null; phone?: string | null } | null | undefined,
) => {
  const parts = [customer?.email, customer?.phone].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(" • ") : "No contact details saved";
};

export const formatCaptureRelativeMinutes = (
  targetDate: string | null | undefined,
  options?: { suffix?: "ago" | "remaining" },
) => {
  if (!targetDate) {
    return null;
  }

  const targetTime = new Date(targetDate).getTime();
  if (Number.isNaN(targetTime)) {
    return null;
  }

  const diffMs = targetTime - Date.now();
  const diffMinutes = Math.round(Math.abs(diffMs) / 60000);

  if (options?.suffix === "remaining") {
    if (diffMs <= 0) {
      return "expired";
    }
    if (diffMinutes <= 1) {
      return "less than 1 min left";
    }
    return `${diffMinutes} min left`;
  }

  if (diffMinutes <= 1) {
    return "just now";
  }

  return `${diffMinutes} min ago`;
};
