/** The only file allowed to import `stripe`. Verifies, normalizes, refunds. Never touches the DB. */
import Stripe from "stripe";
import {
  WebhookVerificationError,
  type BillingEvent,
  type CreateCheckoutInput,
  type CreateCheckoutResult,
  type IBillingProvider,
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
    case "charge.refunded": {
      const c = object as ChargeLike;
      return { ...base, type: "order_refunded", providerRef: refOf(c.payment_intent) ?? c.id };
    }
    default:
      return { ...base, type: "unknown" };
  }
}
