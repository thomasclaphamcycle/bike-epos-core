import {
  PaymentProvider,
  ProviderCancelResult,
  ProviderCaptureResult,
  ProviderCreateIntentResult,
} from "./paymentProvider";

export class CashProvider implements PaymentProvider {
  async createPaymentIntent(_saleId: string, _amountPence: number): Promise<ProviderCreateIntentResult> {
    return {
      status: "CAPTURED",
      externalRef: `cash_${Date.now()}`,
    };
  }

  async capturePayment(_intentId: string): Promise<ProviderCaptureResult> {
    return {
      status: "CAPTURED",
    };
  }

  async cancelPayment(_intentId: string): Promise<ProviderCancelResult> {
    return {
      status: "CANCELED",
    };
  }
}

