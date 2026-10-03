/**
 * Long-running business processes as durable workflows. A review can sit for
 * days; a refund needs a human decision and then a provider call that may
 * fail. Both survive deploys and restarts because state lives in Postgres,
 * not in a process.
 *
 * Serverless has no resident worker, so due runs are processed by
 * POST /api/workflows/tick — call it from a cron (Vercel Cron, cron-job.org).
 */
import { Engine, WaitTimeoutError, defineWorkflow } from "durable-workflow";
import { PostgresStore } from "durable-workflow/postgres";
import { db } from "@/lib/db";
import { pool } from "@/lib/pg";
import { billingProvider } from "./provider";
import { cancelPayout, markPayoutReversed, markPayoutSent, parkedPayoutRuns, payoutForOrder, payoutToSend, recordOwedPayout } from "./payouts";

export const REVIEW_TIMEOUT_MS = 7 * 24 * 3600_000;
export const REFUND_DECISION_TIMEOUT_MS = 3 * 24 * 3600_000;

/** What the webhook sends a parked payout when its seller finishes onboarding. */
export const PAYOUT_READY_SIGNAL = "account-ready";

/** One payout run and one reversal run per order: derived ids, so neither can be started twice. */
export const payoutRunId = (orderId: string) => `payout:${orderId}`;
export const payoutReversalRunId = (orderId: string) => `payout-reversal:${orderId}`;

export interface ReviewDecision {
  approved: boolean;
  reason?: string;
}

export const productReview = defineWorkflow<{ productId: string }, "published" | "rejected">(
  "product-review",
  async (ctx, { productId }) => {
    await ctx.step("mark-pending", async () => {
      await db.product.update({ where: { id: productId }, data: { status: "PENDING_REVIEW", reviewRunId: ctx.runId } });
      return productId;
    });

    let decision: ReviewDecision;
    try {
      decision = await ctx.waitFor<ReviewDecision>("review", { timeoutMs: REVIEW_TIMEOUT_MS });
    } catch (err) {
      // Only the timeout is ours to handle; anything else (including the
      // engine's own suspension signal) must propagate.
      if (!(err instanceof WaitTimeoutError)) throw err;
      decision = { approved: false, reason: "review timed out" };
    }

    if (decision.approved) {
      await ctx.step("publish", async () => {
        await db.product.update({ where: { id: productId }, data: { status: "PUBLISHED" } });
        return productId;
      });
      return "published";
    }
    await ctx.step("reject", async () => {
      await db.product.update({ where: { id: productId }, data: { status: "REJECTED" } });
      return productId;
    });
    return "rejected";
  },
);

export const refundRequest = defineWorkflow<{ orderId: string }, "refunded" | "denied">(
  "refund-request",
  async (ctx, { orderId }) => {
    let decision: { approved: boolean };
    try {
      decision = await ctx.waitFor<{ approved: boolean }>("decision", { timeoutMs: REFUND_DECISION_TIMEOUT_MS });
    } catch (err) {
      if (!(err instanceof WaitTimeoutError)) throw err;
      decision = { approved: false };
    }
    if (!decision.approved) return "denied";

    // The provider call is the side effect that must happen exactly once and
    // may fail transiently — so it is a step with retries. The order's status
    // does NOT change here: it changes when the provider's refund webhook
    // arrives, the same way every other status change does.
    await ctx.step(
      "issue-refund",
      async () => {
        const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
        if (!order.providerRef) throw new Error(`order ${orderId} has no providerRef to refund`);
        await billingProvider().refund(order.providerRef);
        return order.providerRef;
      },
      { retry: { maxAttempts: 5, initialDelayMs: 60_000 } },
    );
    return "refunded";
  },
);

/**
 * The seller's share of one sale. Every move of their money is a step: owing it,
 * sending it, writing down that it went — so a crash between any two of them
 * resumes instead of leaving the transfer in doubt.
 */
export const sellerPayout = defineWorkflow<{ orderId: string }, "paid" | "canceled">(
  "seller-payout",
  async (ctx, { orderId }) => {
    const owed = await ctx.step("record-owed", () => recordOwedPayout(orderId, ctx.runId));

    // No timeout on this wait: what a seller has earned does not expire, so an
    // account that was never finished parks the run rather than ending it. The
    // account.updated webhook signals it (server/billing.ts) — otherwise the
    // money would sit until someone noticed.
    if (!owed.ready) await ctx.waitFor(PAYOUT_READY_SIGNAL);

    const payoutRef = await ctx.step(
      "transfer",
      async () => {
        const sendable = await payoutToSend(owed.payoutId);
        if (!sendable) return null; // refunded while we waited; nothing to send
        const { payoutRef } = await billingProvider().sendPayout({ ...sendable, amountMinor: sendable.netMinor, ref: owed.payoutId });
        return payoutRef;
      },
      { retry: { maxAttempts: 5, initialDelayMs: 60_000 } },
    );
    if (payoutRef === null) return "canceled";

    await ctx.step("mark-sent", () => markPayoutSent(owed.payoutId, payoutRef));
    return "paid";
  },
);

/**
 * The other direction: the buyer got their money back, so the seller's share
 * comes back too. A separate run from the payout's because a refund can arrive
 * at any time — including while that one is still waiting for onboarding, when
 * there is nothing to reverse and the payout is cancelled instead.
 */
export const payoutReversal = defineWorkflow<{ orderId: string }, "reversed" | "canceled" | "nothing">(
  "payout-reversal",
  async (ctx, { orderId }) => {
    const payout = await ctx.step("find-payout", () => payoutForOrder(orderId));
    if (!payout) return "nothing"; // an order paid before payouts existed

    if (payout.status !== "PAID") {
      await ctx.step("cancel", async () => {
        // Stop the run still waiting on this seller: once the sale is refunded
        // their finishing onboarding must not pay it out.
        if (payout.runId) await engine().cancel(payout.runId);
        return cancelPayout(payout.id);
      });
      return "canceled";
    }

    const providerRef = payout.providerRef;
    if (!providerRef) throw new Error(`payout ${payout.id} is PAID with no transfer to reverse`);
    await ctx.step(
      "reverse",
      async () => {
        await billingProvider().reversePayout(providerRef);
        return providerRef;
      },
      { retry: { maxAttempts: 5, initialDelayMs: 60_000 } },
    );
    await ctx.step("mark-reversed", () => markPayoutReversed(payout.id));
    return "reversed";
  },
);

/** Both runs get their first pass now, the way the review and refund routes give theirs one. */
export async function startSellerPayout(orderId: string): Promise<string> {
  const runId = await engine().start(sellerPayout, { orderId }, { id: payoutRunId(orderId) });
  await engine().tick(runId);
  return runId;
}

export async function startPayoutReversal(orderId: string): Promise<string> {
  const runId = await engine().start(payoutReversal, { orderId }, { id: payoutReversalRunId(orderId) });
  await engine().tick(runId);
  return runId;
}

/** Wake every payout parked on this seller's onboarding. */
export async function resumeParkedPayouts(sellerId: string): Promise<void> {
  for (const runId of await parkedPayoutRuns(sellerId)) {
    try {
      await engine().signal(runId, PAYOUT_READY_SIGNAL, {});
    } catch {
      // The run may have finished or been cancelled since the row was written.
      // The payout row is the record of what is owed; a signal with nowhere to
      // land is not news.
    }
  }
}

const globalForEngine = globalThis as unknown as { workflowEngine?: Engine; workflowStore?: PostgresStore };

export function workflowStore(): PostgresStore {
  return (globalForEngine.workflowStore ??= new PostgresStore(pool()));
}

export function engine(): Engine {
  return (globalForEngine.workflowEngine ??= new Engine({
    store: workflowStore(),
    workflows: [productReview, refundRequest, sellerPayout, payoutReversal],
  }));
}
