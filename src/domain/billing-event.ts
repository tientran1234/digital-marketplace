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
  | "payout_account_updated"
  | "unknown";

export interface BillingEvent {
  providerEventId: string;
  type: BillingEventType;
  /** Provider's subscription id or payment intent id. */
  providerRef?: string;
  /** Provider's checkout session id. */
  checkoutRef?: string;
  currentPeriodEnd?: Date;
  /** Whether a seller's connected account may receive money, on payout_account_updated. */
  payoutsEnabled?: boolean;
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

export interface CreatePayoutAccountInput {
  /** Our seller id, kept on the provider's account so a stray one leads back here. */
  sellerId: string;
  email: string;
}

export interface PayoutOnboardingInput {
  accountRef: string;
  /** Where the provider sends a seller whose link went stale before they finished. */
  refreshUrl: string;
  returnUrl: string;
}

export interface SendPayoutInput {
  accountRef: string;
  amountMinor: number;
  currency: string;
  /** Our payout id. The provider's idempotency key, so a retried step cannot pay twice. */
  ref: string;
}

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
  /** Create the seller's connected account. Onboarding itself happens on the provider's screens. */
  createPayoutAccount(input: CreatePayoutAccountInput): Promise<{ accountRef: string }>;
  /** A fresh link into those screens. Single-use and short-lived, so it is minted per click. */
  payoutOnboardingUrl(input: PayoutOnboardingInput): Promise<string>;
  /** Move a seller's share to their account. Idempotent on `input.ref` — the workflow retries it. */
  sendPayout(input: SendPayoutInput): Promise<{ payoutRef: string }>;
  /** Take that transfer back, because the buyer was refunded. */
  reversePayout(payoutRef: string): Promise<void>;
}

export class WebhookVerificationError extends Error {
  override readonly name = "WebhookVerificationError";
}
