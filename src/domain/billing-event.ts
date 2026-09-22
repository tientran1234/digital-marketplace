/**
 * Provider-neutral billing contract. Business logic switches on these types,
 * never on Stripe's. src/providers/stripe.ts is the only file that imports
 * `stripe`; adding PayOS or Paddle is one adapter, nothing else changes.
 */
export type BillingEventType =
  | "order_paid"
  | "order_expired"
  | "order_refunded"
  | "subscription_activated"
  | "subscription_payment_failed"
  | "subscription_canceled"
  | "unknown";

export interface BillingEvent {
  providerEventId: string;
  type: BillingEventType;
  /** Provider's subscription id or payment intent id. */
  providerRef?: string;
  /** Provider's checkout session id. */
  checkoutRef?: string;
  currentPeriodEnd?: Date;
}

export type CreateCheckoutInput =
  | {
      mode: "payment";
      /** Our order id — echoed back on webhooks. */
      ref: string;
      amountMinor: number;
      currency: string;
      description: string;
      customerEmail?: string;
      successUrl: string;
      cancelUrl: string;
    }
  | {
      mode: "subscription";
      /** Our subscription id — echoed back on webhooks. */
      ref: string;
      priceRef: string;
      customerEmail?: string;
      successUrl: string;
      cancelUrl: string;
    };

export interface CreateCheckoutResult {
  checkoutUrl: string;
  checkoutRef: string;
}

export interface IBillingProvider {
  readonly name: string;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  /** Verify over the RAW bytes, then normalize. Throws WebhookVerificationError on a bad signature. */
  verifyWebhook(rawBody: string, signature: string): Promise<BillingEvent>;
  /** Refund a paid order by its providerRef. The status change arrives later, via webhook. */
  refund(providerRef: string): Promise<void>;
}

export class WebhookVerificationError extends Error {
  override readonly name = "WebhookVerificationError";
}
