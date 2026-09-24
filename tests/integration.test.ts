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
import { engine, productReview, refundRequest, workflowStore } from "@/server/workflows";
import { askAboutProduct, setEmbedderForTests, setModelProviderForTests } from "@/server/assistant";
import { currentPeriod } from "@/server/usage";

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

  it("review: submit → PENDING_REVIEW → approve → PUBLISHED", async () => {
    const draft = await db.product.create({ data: { sellerId, slug: "draft", title: "Draft", description: "desc desc desc", priceMinor: 0, fileKey: "d/d.md" } });
    const runId = await engine().start(productReview, { productId: draft.id });
    expect((await engine().tick(runId)).status).toBe("waiting");
    expect((await db.product.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("PENDING_REVIEW");

    const run = await engine().signal(runId, "review", { approved: true });
    expect(run.output).toBe("published");
    expect((await db.product.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("PUBLISHED");
  });

  it("indexes a document into pgvector and retrieves the relevant passage", async () => {
    const chunks = await indexProduct(productId, "# Guide\n\n## Refunds\nRefunds are granted within fourteen days.\n\n## Billing\nAnnual billing gets a fifteen percent discount.", new HashEmbedder());
    expect(chunks).toHaveLength(2);
    const passages = await retrieve(productId, "how many days for a refund", new HashEmbedder(), { k: 1 });
    expect(passages[0]?.content).toMatch(/fourteen days/);
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
