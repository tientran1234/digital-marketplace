import { createHmac } from "node:crypto";
import {
  WebhookVerificationError,
  type BillingEvent,
  type CreateCheckoutInput,
  type CreateCheckoutResult,
  type IBillingProvider,
} from "@/domain/billing-event";

/** In-memory provider: the whole purchase flow runs in tests with no Stripe. */
export class FakeBillingProvider implements IBillingProvider {
  readonly name = "fake";
  readonly refunds: string[] = [];
  constructor(private readonly secret = "fake") {}

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const checkoutRef = `cs_fake_${input.ref}`;
    return { checkoutUrl: `https://fake.checkout/${checkoutRef}`, checkoutRef };
  }
  sign(body: string) {
    return createHmac("sha256", this.secret).update(body).digest("hex");
  }
  async verifyWebhook(rawBody: string, signature: string): Promise<BillingEvent> {
    if (signature !== this.sign(rawBody)) throw new WebhookVerificationError("bad signature");
    const e = JSON.parse(rawBody) as BillingEvent & { currentPeriodEnd?: string };
    return { ...e, currentPeriodEnd: e.currentPeriodEnd ? new Date(e.currentPeriodEnd) : undefined };
  }
  async refund(providerRef: string) {
    this.refunds.push(providerRef);
  }
}
