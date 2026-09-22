import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { normalize } from "@/providers/stripe";

const ev = (type: string, object: unknown) => ({ id: "evt_1", type, data: { object } }) as unknown as Stripe.Event;

describe("stripe → neutral events", () => {
  it("routes checkout completion by mode, and only settles a paid payment", () => {
    expect(normalize(ev("checkout.session.completed", { id: "cs", mode: "payment", payment_status: "paid", payment_intent: "pi_1" })))
      .toMatchObject({ type: "order_paid", checkoutRef: "cs", providerRef: "pi_1" });
    expect(normalize(ev("checkout.session.completed", { id: "cs", mode: "payment", payment_status: "unpaid" })).type).toBe("unknown");
    expect(normalize(ev("checkout.session.completed", { id: "cs", mode: "subscription", subscription: { id: "sub_1" } })))
      .toMatchObject({ type: "subscription_activated", providerRef: "sub_1" });
  });
  it("maps the rest", () => {
    expect(normalize(ev("checkout.session.expired", { id: "cs", mode: "payment" })).type).toBe("order_expired");
    expect(normalize(ev("checkout.session.expired", { id: "cs", mode: "subscription" })).type).toBe("unknown");
    expect(normalize(ev("invoice.paid", { subscription: "sub_1", lines: { data: [{ period: { end: 1_800_000_000 } }] } })))
      .toMatchObject({ type: "subscription_activated", currentPeriodEnd: new Date(1_800_000_000_000) });
    expect(normalize(ev("invoice.payment_failed", { subscription: "sub_1" })).type).toBe("subscription_payment_failed");
    expect(normalize(ev("customer.subscription.deleted", { id: "sub_1" })).type).toBe("subscription_canceled");
    expect(normalize(ev("charge.refunded", { id: "ch_1", payment_intent: "pi_1" }))).toMatchObject({ type: "order_refunded", providerRef: "pi_1" });
    expect(normalize(ev("customer.created", {})).type).toBe("unknown");
  });
});
