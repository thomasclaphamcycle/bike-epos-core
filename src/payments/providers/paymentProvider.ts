export type PaymentIntentLifecycleStatus =
  | "REQUIRES_ACTION"
  | "AUTHORIZED"
  | "CAPTURED"
  | "FAILED"
  | "CANCELED";

export type ProviderCreateIntentResult = {
  status: PaymentIntentLifecycleStatus;
  externalRef?: string;
};

export type ProviderCaptureResult = {
  status: PaymentIntentLifecycleStatus;
  externalRef?: string;
};

export type ProviderCancelResult = {
  status: PaymentIntentLifecycleStatus;
};

export interface PaymentProvider {
  createPaymentIntent(saleId: string, amountPence: number): Promise<ProviderCreateIntentResult>;
  capturePayment(intentId: string): Promise<ProviderCaptureResult>;
  cancelPayment(intentId: string): Promise<ProviderCancelResult>;
}

