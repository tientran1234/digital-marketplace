/** The only file allowed to import `stripe`. Verifies, normalizes, refunds. Never touches the DB. */
import Stripe from "stripe";
import {
  WebhookVerificationError,
  type BillingEvent,
  type CreateCheckoutInput,
  type CreateCheckoutResult,
  type CreatePayoutAccountInput,
  type IBillingProvider,
  type PayoutOnboardingInput,
  type SendPayoutInput,
} from "@/domain/billing-event";

interface SessionLike {
  id: string;
  mode?: string;
  payment_status?: string;
  subscription?: string | { id: string } | null;
  payment_intent?: string | { id: string } | null;
}
interface InvoiceLike {
  subscription?: string | { id: string } | null;
  lines?: { data?: Array<{ period?: { end?: number } }> };
}
interface ChargeLike {
  id: string;
  payment_intent?: string | { id: string } | null;
}
interface AccountLike {
  id: string;
  payouts_enabled?: boolean;
}

const refOf = (v: unknown): string | undefined =>
  typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : undefined;

export class StripeProvider implements IBillingProvider {
  readonly name = "stripe";
  private readonly stripe: Stripe;
  constructor(secretKey: string, private readonly webhookSecret: string) {
    this.stripe = new Stripe(secretKey);
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const common = {
      client_reference_id: input.ref,
      customer_email: input.customerEmail,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: { ref: input.ref, mode: input.mode },
    };
    const session =
      input.mode === "payment"
        ? await this.stripe.checkout.sessions.create({
            ...common,
            mode: "payment",
            line_items: [{ quantity: 1, price_data: { currency: input.currency, unit_amount: input.amountMinor, product_data: { name: input.description } } }],
          })
        : await this.stripe.checkout.sessions.create({
            ...common,
            mode: "subscription",
            line_items: [{ quantity: 1, price: input.priceRef }],
            subscription_data: { metadata: { ref: input.ref } },
          });
    if (!session.url) throw new Error("Stripe returned a session with no URL");
    return { checkoutUrl: session.url, checkoutRef: session.id };
  }

  async verifyWebhook(rawBody: string, signature: string): Promise<BillingEvent> {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (err) {
      throw new WebhookVerificationError((err as Error).message);
    }
    return normalize(event);
  }

  async refund(providerRef: string): Promise<void> {
    await this.stripe.refunds.create({ payment_intent: providerRef });
  }

  async createPayoutAccount({ sellerId, email }: CreatePayoutAccountInput): Promise<{ accountRef: string }> {
    const account = await this.stripe.accounts.create({
      type: "express",
      email,
      // Transfers are all we ask for: the buyer pays us, so this account never
      // takes a card of its own.
      capabilities: { transfers: { requested: true } },
      metadata: { sellerId },
    });
    return { accountRef: account.id };
  }

  async payoutOnboardingUrl({ accountRef, refreshUrl, returnUrl }: PayoutOnboardingInput): Promise<string> {
    const link = await this.stripe.accountLinks.create({
      account: accountRef,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });
    return link.url;
  }

  /**
   * A transfer off the platform balance rather than a destination charge: the
   * fee is ours to compute (domain/payout.ts) and the money has already
   * arrived, so all that is left is moving the seller's share. Our payout id is
   * the idempotency key, which is what makes the workflow's retry safe.
   */
  async sendPayout({ accountRef, amountMinor, currency, ref }: SendPayoutInput): Promise<{ payoutRef: string }> {
    const transfer = await this.stripe.transfers.create(
      { destination: accountRef, amount: amountMinor, currency, metadata: { payoutId: ref } },
      { idempotencyKey: `payout:${ref}` },
    );
    return { payoutRef: transfer.id };
  }

  async reversePayout(payoutRef: string): Promise<void> {
    await this.stripe.transfers.createReversal(payoutRef, {}, { idempotencyKey: `payout-reversal:${payoutRef}` });
  }
}

const secondsToDate = (s: unknown) => (typeof s === "number" ? new Date(s * 1000) : undefined);

/** Stripe events → neutral events. Exported so the mapping is testable without Stripe. */
export function normalize(event: Stripe.Event): BillingEvent {
  const base = { providerEventId: event.id };
  const object = event.data.object as unknown;
  switch (event.type) {
    case "checkout.session.completed": {
      const s = object as SessionLike;
      if (s.mode === "subscription") return { ...base, type: "subscription_activated", checkoutRef: s.id, providerRef: refOf(s.subscription) };
      // "completed" is not "paid" for async payment methods; only settle on paid.
      return { ...base, type: s.payment_status === "paid" ? "order_paid" : "unknown", checkoutRef: s.id, providerRef: refOf(s.payment_intent) };
    }
    case "checkout.session.async_payment_succeeded": {
      const s = object as SessionLike;
      return { ...base, type: "order_paid", checkoutRef: s.id, providerRef: refOf(s.payment_intent) };
    }
    case "checkout.session.expired": {
      const s = object as SessionLike;
      return { ...base, type: s.mode === "payment" ? "order_expired" : "unknown", checkoutRef: s.id };
    }
    case "invoice.paid": {
      const i = object as InvoiceLike;
      return { ...base, type: "subscription_activated", providerRef: refOf(i.subscription), currentPeriodEnd: secondsToDate(i.lines?.data?.[0]?.period?.end) };
    }
    case "invoice.payment_failed": {
      const i = object as InvoiceLike;
      return { ...base, type: "subscription_payment_failed", providerRef: refOf(i.subscription) };
    }
    case "customer.subscription.deleted": {
      const s = object as { id: string };
      return { ...base, type: "subscription_canceled", providerRef: s.id };
    }
    case "account.updated": {
      // Connect's own event, for the seller's account rather than a purchase.
      const a = object as AccountLike;
      return { ...base, type: "payout_account_updated", providerRef: a.id, payoutsEnabled: a.payouts_enabled === true };
    }
    case "charge.refunded": {
      const c = object as ChargeLike;
      return { ...base, type: "order_refunded", providerRef: refOf(c.payment_intent) ?? c.id };
    }
    default:
      return { ...base, type: "unknown" };
  }
}
