/**
 * The purchase, refund and review flows end to end, against a real Postgres
 * with pgvector: billing state machine, idempotent webhooks, durable workflows,
 * RAG indexing + retrieval, and the assistant with a scripted model.
 *
 *   DATABASE_URL=… pnpm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeProvider, callTools, reply, type AgentEvent } from "agent-runtime";
import { db } from "@/lib/db";
import { pool } from "@/lib/pg";
import { HashEmbedder, indexProduct, retrieve } from "@/rag";
import { FakeBillingProvider } from "@/providers/fake";
import { setBillingProviderForTests } from "@/server/provider";
import { applyEvent, entitlementsForUser, startOrderCheckout } from "@/server/billing";
import { recordProductView, sellerAnalytics } from "@/server/analytics";
import { engine, payoutRunId, productReview, refundRequest, workflowStore } from "@/server/workflows";
import { sellerPayoutStatus, startPayoutOnboarding } from "@/server/payouts";
import { moderateReview, pendingReviews, productRating, publishedReviews, reviewEligibilityFor, submitReview } from "@/server/reviews";
import { NO_RATINGS } from "@/domain/review";
import { askAboutProduct, setEmbedderForTests, setModelProviderForTests } from "@/server/assistant";
import { currentPeriod } from "@/server/usage";
import { issueSession } from "@/server/auth";
import { setMailerForTests, type Email } from "@/server/mail";
import { MAX_REQUESTS, LINK_TTL_MS } from "@/domain/magic-link";
import { hashLoginToken, redeemSignInLink, requestSignInLink } from "@/server/magic-link";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("marketplace flows", () => {
  const billing = new FakeBillingProvider();
  let sellerId: string;
  let buyerId: string;
  let productId: string;

  beforeAll(async () => {
    await workflowStore().ensureSchema();
    setBillingProviderForTests(billing);
    setEmbedderForTests(new HashEmbedder());
  });
  beforeEach(async () => {
    await db.webhookEvent.deleteMany();
    await db.agentTrace.deleteMany();
    await db.user.deleteMany();
    await pool().query("DELETE FROM workflow_runs");
    sellerId = (await db.user.create({ data: { email: "s@t.test", name: "Seller", role: "SELLER" } })).id;
    buyerId = (await db.user.create({ data: { email: "b@t.test", name: "Buyer", role: "BUYER" } })).id;
    productId = (await db.product.create({ data: { sellerId, slug: "guide", title: "Guide", description: "A guide about refunds and pricing", priceMinor: 1900, status: "PUBLISHED", fileKey: "x/y.md" } })).id;
  });
  afterAll(async () => {
    setBillingProviderForTests(null);
    setEmbedderForTests(null);
    setModelProviderForTests(null);
    await db.$disconnect();
    await pool().end();
  });

  it("purchase: PENDING before the provider call, PAID on the webhook, replay ignored", async () => {
    const { orderId, checkoutUrl } = await startOrderCheckout(buyerId, productId);
    expect(checkoutUrl).toContain("cs_fake_");
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PENDING");

    const paid = { providerEventId: "evt_paid", type: "order_paid" as const, checkoutRef: `cs_fake_${orderId}`, providerRef: "pi_1" };
    expect(await applyEvent("fake", paid)).toBe("transitioned");
    expect(await applyEvent("fake", paid)).toBe("duplicate");
    expect(await db.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: "PAID", providerRef: "pi_1" });
  });

  it("refund: buyer asks, admin approves, provider is called once, webhook closes it", async () => {
    const { orderId } = await startOrderCheckout(buyerId, productId);
    await applyEvent("fake", { providerEventId: "e1", type: "order_paid", checkoutRef: `cs_fake_${orderId}`, providerRef: "pi_9" });

    const runId = await engine().start(refundRequest, { orderId });
    expect((await engine().tick(runId)).status).toBe("waiting");
    expect(billing.refunds).toEqual([]);

    const run = await engine().signal(runId, "decision", { approved: true });
    expect(run.status).toBe("completed");
    expect(run.output).toBe("refunded");
    expect(billing.refunds).toEqual(["pi_9"]);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PAID"); // not yet — the webhook does it

    expect(await applyEvent("fake", { providerEventId: "e2", type: "order_refunded", providerRef: "pi_9" })).toBe("transitioned");
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("REFUNDED");
  });

  it("payout: parked until the seller can be paid, then the sale minus the fee, and a refund takes it back", async () => {
    const { orderId } = await startOrderCheckout(buyerId, productId);
    expect(await applyEvent("fake", { providerEventId: "y1", type: "order_paid", checkoutRef: `cs_fake_${orderId}`, providerRef: "pi_y" })).toBe("transitioned");

    // Owed the moment the money lands. Nothing moves: there is nowhere to send it.
    const payout = await db.payout.findUniqueOrThrow({ where: { orderId } });
    expect(payout).toMatchObject({ status: "PENDING", amountMinor: 1900, feeMinor: 190, netMinor: 1710 });
    expect((await workflowStore().get(payoutRunId(orderId)))?.status).toBe("waiting");
    expect(billing.payouts.map((p) => p.ref)).not.toContain(payout.id);

    expect(await startPayoutOnboarding({ id: sellerId, email: "s@t.test" }, "en")).toContain(`acct_fake_${sellerId}`);

    // Onboarding finished: the webhook wakes the parked run, which sends the
    // seller's share and not a unit more.
    expect(await applyEvent("fake", { providerEventId: "y2", type: "payout_account_updated", providerRef: `acct_fake_${sellerId}`, payoutsEnabled: true })).toBe("transitioned");
    expect(billing.payouts).toContainEqual({ ref: payout.id, accountRef: `acct_fake_${sellerId}`, amountMinor: 1710, currency: "usd" });
    expect(await db.payout.findUniqueOrThrow({ where: { orderId } })).toMatchObject({ status: "PAID", providerRef: `tr_fake_${payout.id}` });
    expect(await sellerPayoutStatus(sellerId)).toMatchObject({
      readiness: { ready: true },
      totals: [{ currency: "usd", pendingMinor: 0, paidMinor: 1710, reversedMinor: 0 }],
    });

    // The refund comes back through the same webhook path as the order's own status.
    expect(await applyEvent("fake", { providerEventId: "y3", type: "order_refunded", providerRef: "pi_y" })).toBe("transitioned");
    expect(billing.reversals).toContain(`tr_fake_${payout.id}`);
    expect((await db.payout.findUniqueOrThrow({ where: { orderId } })).status).toBe("REVERSED");
  });

  it("payout: a refund before the seller onboards cancels it, so finishing later pays nothing", async () => {
    const { orderId } = await startOrderCheckout(buyerId, productId);
    await applyEvent("fake", { providerEventId: "z1", type: "order_paid", checkoutRef: `cs_fake_${orderId}`, providerRef: "pi_z" });
    const payout = await db.payout.findUniqueOrThrow({ where: { orderId } });

    await applyEvent("fake", { providerEventId: "z2", type: "order_refunded", providerRef: "pi_z" });
    expect((await db.payout.findUniqueOrThrow({ where: { orderId } })).status).toBe("CANCELED");
    expect((await workflowStore().get(payoutRunId(orderId)))?.status).toBe("canceled");

    await startPayoutOnboarding({ id: sellerId, email: "s@t.test" }, "en");
    await applyEvent("fake", { providerEventId: "z3", type: "payout_account_updated", providerRef: `acct_fake_${sellerId}`, payoutsEnabled: true });
    expect(billing.payouts.map((p) => p.ref)).not.toContain(payout.id);
    expect(billing.reversals).not.toContain(`tr_fake_${payout.id}`);
  });

  it("review: submit → PENDING_REVIEW → approve → PUBLISHED", async () => {
    const draft = await db.product.create({ data: { sellerId, slug: "draft", title: "Draft", description: "desc desc desc", priceMinor: 0, fileKey: "d/d.md" } });
    const runId = await engine().start(productReview, { productId: draft.id });
    expect((await engine().tick(runId)).status).toBe("waiting");
    expect((await db.product.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("PENDING_REVIEW");

    const run = await engine().signal(runId, "review", { approved: true });
    expect(run.output).toBe("published");
    expect((await db.product.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("PUBLISHED");
  });

  it("reviews: a purchase earns one rating, and nothing is on the listing before an admin reads it", async () => {
    const { orderId } = await startOrderCheckout(buyerId, productId);

    // Nothing bought yet: no form to draw, and the route refuses an order id
    // that was guessed rather than earned.
    expect(await reviewEligibilityFor(productId, buyerId)).toMatchObject({ allowed: false, reason: "not_purchased" });
    expect(await submitReview({ orderId, userId: buyerId, rating: 5 })).toMatchObject({ submitted: false, reason: "not_purchased" });

    await applyEvent("fake", { providerEventId: "v1", type: "order_paid", checkoutRef: `cs_fake_${orderId}`, providerRef: "pi_v1" });
    expect(await reviewEligibilityFor(productId, buyerId)).toEqual({ allowed: true, orderId });

    const submitted = await submitReview({ orderId, userId: buyerId, rating: 4, body: "  Clear and short.  " });
    expect(submitted).toMatchObject({ submitted: true });
    if (!submitted.submitted) throw new Error("unreachable");

    // Pending is invisible: no number on the card, no row on the page.
    expect(await productRating(productId)).toEqual(NO_RATINGS);
    expect(await publishedReviews(productId)).toEqual([]);
    expect(await pendingReviews()).toHaveLength(1);

    // One review per purchase, and not one the buyer never made.
    expect(await submitReview({ orderId, userId: buyerId, rating: 1 })).toMatchObject({ submitted: false, reason: "already_reviewed" });
    expect(await reviewEligibilityFor(productId, buyerId)).toMatchObject({ allowed: false, reason: "already_reviewed" });
    const stranger = await db.user.create({ data: { email: "nosy@t.test", name: "Nosy", role: "BUYER" } });
    expect(await submitReview({ orderId, userId: stranger.id, rating: 5 })).toMatchObject({ submitted: false, reason: "not_purchased" });

    expect(await moderateReview(submitted.reviewId, true)).toBe(true);
    // Decided once: the second click of two finds nothing to change.
    expect(await moderateReview(submitted.reviewId, false)).toBe(false);
    expect(await productRating(productId)).toEqual({ count: 1, average: 4 });
    expect((await publishedReviews(productId))[0]).toMatchObject({ rating: 4, body: "Clear and short." });
    expect(await pendingReviews()).toEqual([]);
  });

  it("reviews: a second sale earns a second rating, and a rejected one is in no average", async () => {
    const said: string[] = [];
    for (const [i, rating] of [5, 1].entries()) {
      const { orderId } = await startOrderCheckout(buyerId, productId);
      await applyEvent("fake", { providerEventId: `w${i}`, type: "order_paid", checkoutRef: `cs_fake_${orderId}`, providerRef: `pi_w${i}` });
      const outcome = await submitReview({ orderId, userId: buyerId, rating });
      if (!outcome.submitted) throw new Error(`rating ${rating} was refused: ${outcome.reason}`);
      said.push(outcome.reviewId);
    }
    // Two sales, two things to say about them — the buyer is not limited to one.
    expect(said).toHaveLength(2);

    await moderateReview(said[0], true);
    await moderateReview(said[1], false);
    expect(await productRating(productId)).toEqual({ count: 1, average: 5 });
    expect(await publishedReviews(productId)).toHaveLength(1);
  });

  it("indexes a document into pgvector and retrieves the relevant passage", async () => {
    const chunks = await indexProduct(productId, "# Guide\n\n## Refunds\nRefunds are granted within fourteen days.\n\n## Billing\nAnnual billing gets a fifteen percent discount.", new HashEmbedder());
    expect(chunks).toHaveLength(2);
    const passages = await retrieve(productId, "how many days for a refund", new HashEmbedder(), { k: 1 });
    expect(passages[0]?.content).toMatch(/fourteen days/);
  });

  it("seller analytics: an audience that excludes the seller, sales that survived a refund, questions from traces", async () => {
    const quiet = await db.product.create({ data: { sellerId, slug: "quiet", title: "Quiet", description: "Nobody has looked at this one", priceMinor: 500, status: "PUBLISHED", fileKey: "q/q.md" } });
    for (const viewer of [buyerId, null, sellerId]) await recordProductView({ id: productId, sellerId }, viewer);

    const kept = await startOrderCheckout(buyerId, productId);
    await applyEvent("fake", { providerEventId: "a1", type: "order_paid", checkoutRef: `cs_fake_${kept.orderId}`, providerRef: "pi_a1" });
    const returned = await startOrderCheckout(buyerId, productId);
    await applyEvent("fake", { providerEventId: "a2", type: "order_paid", checkoutRef: `cs_fake_${returned.orderId}`, providerRef: "pi_a2" });
    await applyEvent("fake", { providerEventId: "a3", type: "order_refunded", providerRef: "pi_a2" });
    await startOrderCheckout(buyerId, productId); // never paid for
    await db.agentTrace.create({ data: { runId: "run_a1", userId: buyerId, productId, status: "ok", modelCalls: 2, toolCalls: 1, inputTokens: 100, outputTokens: 20, costUsd: 0.001, durationMs: 42, spans: [] } });

    const rows = await sellerAnalytics(sellerId);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.productId === productId)).toMatchObject({ views: 2, purchases: 1, questions: 1 });
    expect(rows.find((r) => r.productId === quiet.id)).toMatchObject({ views: 0, purchases: 0, questions: 0 });

    // One seller's report never reaches into another's listings.
    const other = await db.user.create({ data: { email: "s2@t.test", name: "Other", role: "SELLER" } });
    expect(await sellerAnalytics(other.id)).toEqual([]);
  });

  it("assistant: gated by quota, calls search_docs, and leaves a trace with cost", async () => {
    await indexProduct(productId, "## Refunds\nRefunds are granted within fourteen days.", new HashEmbedder());
    setModelProviderForTests(new FakeProvider([
      callTools([{ name: "search_docs", input: { query: "refund days" }, id: "t1" }]),
      reply("Refunds are granted within fourteen days [1].", { inputTokens: 100, outputTokens: 20 }),
    ], "claude-opus-5"));

    const user = await db.user.findUniqueOrThrow({ where: { id: buyerId } });
    const product = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { seller: { select: { name: true } } } });
    const result = await askAboutProduct({ user, product, question: "How long do I have to ask for a refund?" });

    expect(result.status).toBe("completed");
    expect(result.text).toMatch(/fourteen days/);
    const trace = await db.agentTrace.findFirstOrThrow({ where: { userId: buyerId } });
    expect(trace).toMatchObject({ modelCalls: 2, toolCalls: 1, status: "ok" });
    expect(trace.costUsd).toBeGreaterThan(0);
    expect((await entitlementsForUser(buyerId)).planKey).toBe("free");
  });

  it("assistant: a provider error before any output gives the message back", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: buyerId } });
    const product = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { seller: { select: { name: true } } } });
    const used = async () =>
      (await db.usageCounter.findUnique({ where: { userId_feature_period: { userId: buyerId, feature: "aiMessages", period: currentPeriod() } } }))?.used ?? 0;

    setModelProviderForTests(new FakeProvider([new Error("provider is down")], "claude-opus-5"));
    await expect(askAboutProduct({ user, product, question: "How long do I have?" })).rejects.toThrow("provider is down");
    expect(await used()).toBe(0);

    // The same failure after the buyer has read something still costs a message.
    const seen: string[] = [];
    setModelProviderForTests(new FakeProvider([
      callTools([{ name: "product_facts", input: {} }], "Let me check the listing."),
      new Error("provider is down"),
    ], "claude-opus-5"));
    const onEvent = (e: AgentEvent) => {
      if (e.type === "text_delta") seen.push(e.text);
    };
    await expect(askAboutProduct({ user, product, question: "How much is it?", onEvent })).rejects.toThrow("provider is down");
    expect(seen.join("")).toBe("Let me check the listing.");
    expect(await used()).toBe(1);
  });
});

describe.skipIf(!hasDb)("magic-link sign-in", () => {
  const outbox: Email[] = [];
  /** The token is only ever in the email, so the email is where the test has to read it from too. */
  const tokenFrom = (message: Email) => new URL(/https?:\/\/\S+/.exec(message.text)![0]).searchParams.get("token")!;

  beforeAll(() => {
    setMailerForTests({ name: "log", async send(message) { outbox.push(message); } });
  });
  beforeEach(async () => {
    outbox.length = 0;
    await db.loginToken.deleteMany();
    await db.user.deleteMany();
  });

  it("signs in an address that has never been here, as a buyer", async () => {
    await requestSignInLink("new@example.test", "en");
    expect(outbox).toHaveLength(1);

    // Nothing exists until the link comes back: otherwise anyone who can type
    // an address can fill the user table with addresses they do not own.
    expect(await db.user.count()).toBe(0);

    const result = await redeemSignInLink(tokenFrom(outbox[0]!));
    expect(result).toMatchObject({ ok: true, locale: "en" });
    expect(result.ok && result.user.role).toBe("BUYER");

    const cookie = await issueSession((result as { user: { id: string } }).user.id);
    expect(await db.session.findUnique({ where: { id: cookie.value } })).not.toBeNull();
  });

  it("keeps the role the account already had", async () => {
    await db.user.create({ data: { email: "boss@example.test", name: "Boss", role: "ADMIN" } });
    await requestSignInLink("boss@example.test", "vi");
    const result = await redeemSignInLink(tokenFrom(outbox[0]!));
    expect(result).toMatchObject({ ok: true, locale: "vi" });
    expect(result.ok && result.user.role).toBe("ADMIN");
  });

  it("works once", async () => {
    await requestSignInLink("once@example.test", "en");
    const token = tokenFrom(outbox[0]!);
    expect(await redeemSignInLink(token)).toMatchObject({ ok: true });

    const sessions = await db.session.count();
    expect(await redeemSignInLink(token)).toEqual({ ok: false, reason: "consumed" });
    expect(await db.session.count()).toBe(sessions);
  });

  it("stops working after its window, and a token nobody issued never worked", async () => {
    await requestSignInLink("late@example.test", "en");
    const token = tokenFrom(outbox[0]!);
    expect(await redeemSignInLink(token, new Date(Date.now() + LINK_TTL_MS + 1))).toEqual({ ok: false, reason: "expired" });
    expect(await redeemSignInLink("not-a-token")).toEqual({ ok: false, reason: "unknown" });
    expect(await db.user.count()).toBe(0);
  });

  /** The row is a fingerprint of the link; reading the table must not hand anyone a way in. */
  it("never writes the token itself down", async () => {
    await requestSignInLink("hash@example.test", "en");
    const token = tokenFrom(outbox[0]!);
    const row = await db.loginToken.findFirstOrThrow();
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(hashLoginToken(token));
  });

  it("stops sending after a mailbox has asked enough times", async () => {
    for (let i = 0; i < MAX_REQUESTS + 3; i++) await requestSignInLink("keen@example.test", "en");
    expect(outbox).toHaveLength(MAX_REQUESTS);
    expect(await db.loginToken.count()).toBe(MAX_REQUESTS);

    // Per address: someone else's sign-in is not collateral damage.
    await requestSignInLink("other@example.test", "en");
    expect(outbox).toHaveLength(MAX_REQUESTS + 1);
  });
});
