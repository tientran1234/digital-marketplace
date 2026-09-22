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

export const REVIEW_TIMEOUT_MS = 7 * 24 * 3600_000;
export const REFUND_DECISION_TIMEOUT_MS = 3 * 24 * 3600_000;

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

const globalForEngine = globalThis as unknown as { workflowEngine?: Engine; workflowStore?: PostgresStore };

export function workflowStore(): PostgresStore {
  return (globalForEngine.workflowStore ??= new PostgresStore(pool()));
}

export function engine(): Engine {
  return (globalForEngine.workflowEngine ??= new Engine({
    store: workflowStore(),
    workflows: [productReview, refundRequest],
  }));
}
