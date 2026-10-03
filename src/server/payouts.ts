/**
 * The seller's side of the money: one connected account per seller, one payout
 * row per paid order. The provider owns the onboarding screens and the transfer;
 * this file owns the rows, and every status change goes through the same kind of
 * conditional UPDATE an order's does, so a step that runs twice cannot pay or
 * reverse twice.
 *
 * No workflow lives here — the runs that call these are in server/workflows.ts.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { payoutPredecessorsOf, payoutReadiness, payoutTotals, splitPayment, type PayoutStatus, type PayoutTotals, type PayoutReadiness } from "@/domain/payout";
import { billingProvider } from "./provider";

export function payoutAccountFor(sellerId: string) {
  return db.payoutAccount.findUnique({ where: { sellerId } });
}

/**
 * The seller's connected account, created on first ask, and a link into the
 * provider's onboarding. The link is single-use and expires, so it is minted per
 * click rather than stored — which is also why a seller who left half way
 * through gets a new one from the same button.
 */
export async function startPayoutOnboarding(seller: { id: string; email: string }, locale: string): Promise<string> {
  const provider = billingProvider();
  const url = `${env().APP_URL}/${locale}/sell`;
  const existing = await payoutAccountFor(seller.id);
  // Two clicks can leave an unused account at the provider; that is better than
  // two rows claiming to be this seller's, so the row is what decides.
  const account =
    existing ??
    (await db.payoutAccount.upsert({
      where: { sellerId: seller.id },
      create: { sellerId: seller.id, provider: provider.name, accountRef: (await provider.createPayoutAccount({ sellerId: seller.id, email: seller.email })).accountRef },
      update: {},
    }));
  return provider.payoutOnboardingUrl({ accountRef: account.accountRef, refreshUrl: url, returnUrl: url });
}

/** @returns whose account it is, or null when it is not an account we issued. */
export async function syncPayoutAccount(accountRef: string, payoutsEnabled: boolean): Promise<{ sellerId: string } | null> {
  const account = await db.payoutAccount.findUnique({ where: { accountRef } });
  if (!account) return null;
  await db.payoutAccount.update({ where: { accountRef }, data: { payoutsEnabled } });
  return { sellerId: account.sellerId };
}

export interface OwedPayout {
  payoutId: string;
  /** Whether the seller can be paid now, or the run has to wait for onboarding. */
  ready: boolean;
}

/**
 * Write down what this sale owes its seller. Keyed by the order and upserted, so
 * the workflow's first step can run again after a lost acknowledgement without
 * owing the same sale twice.
 */
export async function recordOwedPayout(orderId: string, runId: string): Promise<OwedPayout> {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { product: { select: { sellerId: true } } } });
  const { feeMinor, netMinor } = splitPayment(order.amountMinor);
  const sellerId = order.product.sellerId;
  const payout = await db.payout.upsert({
    where: { orderId },
    create: {
      orderId,
      sellerId,
      amountMinor: order.amountMinor,
      feeMinor,
      netMinor,
      currency: order.currency,
      provider: order.provider,
      status: "PENDING" satisfies PayoutStatus,
      runId,
    },
    update: { runId },
  });
  return { payoutId: payout.id, ready: payoutReadiness(await payoutAccountFor(sellerId)).ready };
}

export interface SendablePayout {
  accountRef: string;
  netMinor: number;
  currency: string;
}

/** What the transfer step needs, or null when a refund got here first and there is nothing to send. */
export async function payoutToSend(payoutId: string): Promise<SendablePayout | null> {
  const payout = await db.payout.findUniqueOrThrow({ where: { id: payoutId } });
  if (payout.status !== ("PENDING" satisfies PayoutStatus)) return null;
  const account = await payoutAccountFor(payout.sellerId);
  const readiness = payoutReadiness(account);
  // The step retries: an account that lost its standing between the signal and
  // the transfer is worth waiting for rather than a reason to drop the money.
  if (!account || !readiness.ready) throw new Error(`seller ${payout.sellerId} cannot be paid: ${readiness.ready ? "no_account" : readiness.reason}`);
  return { accountRef: account.accountRef, netMinor: payout.netMinor, currency: payout.currency };
}

export interface ReversiblePayout {
  id: string;
  status: string;
  /** The transfer to take back, once there is one. */
  providerRef: string | null;
  /** The run that owns this payout's money, so a cancellation can stop it waiting. */
  runId: string | null;
}

export function payoutForOrder(orderId: string): Promise<ReversiblePayout | null> {
  return db.payout.findUnique({ where: { orderId }, select: { id: true, status: true, providerRef: true, runId: true } });
}

/** The runs parked on this seller finishing onboarding. */
export async function parkedPayoutRuns(sellerId: string): Promise<string[]> {
  const parked = await db.payout.findMany({
    where: { sellerId, status: "PENDING" satisfies PayoutStatus, runId: { not: null } },
    select: { runId: true },
  });
  return parked.flatMap((p) => (p.runId ? [p.runId] : []));
}

/** Forward-only: the conditional UPDATE is the lock, exactly as it is for orders. */
async function transition(payoutId: string, to: PayoutStatus, data: Prisma.PayoutUpdateManyMutationInput = {}): Promise<boolean> {
  const { count } = await db.payout.updateMany({ where: { id: payoutId, status: { in: payoutPredecessorsOf(to) } }, data: { status: to, ...data } });
  return count === 1;
}

export const markPayoutSent = (payoutId: string, providerRef: string) => transition(payoutId, "PAID", { providerRef });
export const markPayoutReversed = (payoutId: string) => transition(payoutId, "REVERSED");
export const cancelPayout = (payoutId: string) => transition(payoutId, "CANCELED");

export interface SellerPayoutStatus {
  readiness: PayoutReadiness;
  totals: PayoutTotals[];
}

/** The seller page's view: whether they can be paid, and what has moved so far. */
export async function sellerPayoutStatus(sellerId: string): Promise<SellerPayoutStatus> {
  const [account, rows] = await Promise.all([
    payoutAccountFor(sellerId),
    db.payout.findMany({ where: { sellerId }, select: { status: true, netMinor: true, currency: true } }),
  ]);
  return { readiness: payoutReadiness(account), totals: payoutTotals(rows) };
}
