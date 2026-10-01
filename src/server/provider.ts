import type { IBillingProvider } from "@/domain/billing-event";
import { FakeBillingProvider, fakesRequested } from "@/providers/fake";
import { StripeProvider } from "@/providers/stripe";
import { env } from "@/lib/env";

let override: IBillingProvider | null = null;
/** Tests inject a fake here. */
export function setBillingProviderForTests(p: IBillingProvider | null) {
  override = p;
}

export function billingProvider(): IBillingProvider {
  if (override) return override;
  const e = env();
  if (fakesRequested(e)) return new FakeBillingProvider();
  if (!e.STRIPE_SECRET_KEY || !e.STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are not set");
  return new StripeProvider(e.STRIPE_SECRET_KEY, e.STRIPE_WEBHOOK_SECRET);
}
