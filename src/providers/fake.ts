import { createHmac } from "node:crypto";
import { FakeProvider, callTools, reply, type ModelProvider, type ModelRequest } from "agent-runtime";
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

/** In-memory provider: the whole purchase flow runs in tests with no Stripe. */
export class FakeBillingProvider implements IBillingProvider {
  readonly name = "fake";
  readonly refunds: string[] = [];
  readonly payouts: Array<{ ref: string; accountRef: string; amountMinor: number; currency: string }> = [];
  readonly reversals: string[] = [];
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

  async createPayoutAccount({ sellerId }: CreatePayoutAccountInput) {
    return { accountRef: `acct_fake_${sellerId}` };
  }
  async payoutOnboardingUrl({ accountRef, returnUrl }: PayoutOnboardingInput) {
    return `https://fake.connect/${accountRef}?return=${encodeURIComponent(returnUrl)}`;
  }
  /** Idempotent on `ref`, the way the real one is on its idempotency key: a retried transfer is the same transfer. */
  async sendPayout({ accountRef, amountMinor, currency, ref }: SendPayoutInput) {
    if (!this.payouts.some((p) => p.ref === ref)) this.payouts.push({ ref, accountRef, amountMinor, currency });
    return { payoutRef: `tr_fake_${ref}` };
  }
  async reversePayout(payoutRef: string) {
    this.reversals.push(payoutRef);
  }
}

/** How many of the retrieved passages the extractive baseline quotes back. Three is what a short answer would draw on. */
export const QUOTED = 3;

/**
 * The stand-in for a model wherever there is no key: search once, quote the
 * passages that came back. It cannot reason and — the part that matters — it
 * cannot invent, so every point it loses is a point the pipeline lost and the
 * score moves only when the pipeline moves.
 *
 * It also never refuses: with a bag-of-words embedder the similarity of an
 * unanswerable question to its nearest chunk lands squarely inside the range
 * the answerable ones occupy, so there is no threshold to refuse on. Refusal
 * is a judgement, which is why it is scored under EVAL_MODEL=1 and only
 * checked for fabrication here.
 */
export function extractiveBaseline(question: string): ModelProvider {
  const answer = (request: ModelRequest) =>
    reply(
      lastToolResult(request).split("\n\n").slice(0, QUOTED).map((p) => p.replace(/^\[(\d+)\]\s*\([^)]*\)\s*/, "[$1] ")).join(" "),
      { inputTokens: 400, outputTokens: 120 },
    );
  return new FakeProvider([() => callTools([{ name: "search_docs", input: { query: question }, id: "s1" }]), answer], "extractive-baseline");
}

function lastToolResult(request: ModelRequest): string {
  for (const message of [...request.messages].reverse()) {
    for (const part of message.content) if (part.type === "tool_result") return part.content;
  }
  return "";
}

/** The settings that decide whether the fakes are serving. Kept narrow so the choice can be exercised without a whole environment. */
export type FakeEnv = Partial<Record<"FAKE_PROVIDERS" | "STRIPE_SECRET_KEY" | "ANTHROPIC_API_KEY", string>>;

/**
 * `FAKE_PROVIDERS=1` puts the doubles in front of Stripe and the model for a
 * whole server process. The unit tests reach in with `setBillingProviderForTests`
 * and friends; the end-to-end suite drives the app from a browser and cannot,
 * so the choice has to be something the process can be started with.
 *
 * A real credential alongside the flag is an error rather than a preference
 * for one of them. Whichever way that preference fell it would look like a
 * pass: a deployment taking fake money, or a suite quietly spending real
 * tokens against the account whose key happened to be in the environment.
 */
export function fakesRequested(e: FakeEnv): boolean {
  if (e.FAKE_PROVIDERS !== "1") return false;
  const real = (["STRIPE_SECRET_KEY", "ANTHROPIC_API_KEY"] as const).filter((name) => e[name]);
  if (real.length) throw new Error(`FAKE_PROVIDERS=1 alongside real credentials: ${real.join(", ")}`);
  return true;
}
