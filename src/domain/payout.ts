/**
 * What a seller is owed for a sale, and what may happen to it afterwards.
 * Pure, so the workflow that moves the money, the seller's page and the tests
 * all read the split and the state machine from here instead of each deciding
 * for itself what a sale earned.
 */

/** The platform's cut, in basis points. 1000 = 10%. */
export const PLATFORM_FEE_BPS = 1_000;

export interface PaymentSplit {
  grossMinor: number;
  feeMinor: number;
  netMinor: number;
}

/**
 * Split what the buyer paid into our fee and the seller's share. The fee rounds
 * down, so the odd minor unit goes to the seller and fee + net is exactly the
 * gross — a transfer can never ask for more than what arrived.
 */
export function splitPayment(grossMinor: number, feeBps: number = PLATFORM_FEE_BPS): PaymentSplit {
  const feeMinor = Math.floor((grossMinor * feeBps) / 10_000);
  return { grossMinor, feeMinor, netMinor: grossMinor - feeMinor };
}

/** A seller's share of one order. Forward-only, like the order's own status. */
export const PAYOUT_STATUSES = ["PENDING", "PAID", "REVERSED", "CANCELED"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

const ALLOWED: Record<PayoutStatus, PayoutStatus[]> = {
  // A refund that arrives before the transfer leaves nothing to reverse, so the
  // payout is cancelled; one that arrives after it brings the money back.
  PENDING: ["PAID", "CANCELED"],
  PAID: ["REVERSED"],
  REVERSED: [],
  CANCELED: [],
};

export function canTransitionPayout(from: PayoutStatus, to: PayoutStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}
export function payoutPredecessorsOf(to: PayoutStatus): PayoutStatus[] {
  return PAYOUT_STATUSES.filter((from) => canTransitionPayout(from, to));
}

/** Why a seller cannot be paid yet. Onboarding is the provider's screens, not ours. */
export type PayoutReadiness = { ready: true } | { ready: false; reason: "no_account" | "onboarding_incomplete" };

export function payoutReadiness(account: { payoutsEnabled: boolean } | null | undefined): PayoutReadiness {
  if (!account) return { ready: false, reason: "no_account" };
  if (!account.payoutsEnabled) return { ready: false, reason: "onboarding_incomplete" };
  return { ready: true };
}

/** One currency's line on the seller's page. */
export interface PayoutTotals {
  currency: string;
  pendingMinor: number;
  paidMinor: number;
  reversedMinor: number;
}

/**
 * The seller's money, one line per currency — two currencies do not add up.
 * A cancelled payout appears nowhere: nothing ever left the platform, so it is
 * not owed, not paid and not taken back.
 */
export function payoutTotals(rows: readonly { status: string; netMinor: number; currency: string }[]): PayoutTotals[] {
  const lines = new Map<string, PayoutTotals>();
  for (const row of rows) {
    const line = lines.get(row.currency) ?? { currency: row.currency, pendingMinor: 0, paidMinor: 0, reversedMinor: 0 };
    if (row.status === "PENDING") line.pendingMinor += row.netMinor;
    if (row.status === "PAID") line.paidMinor += row.netMinor;
    if (row.status === "REVERSED") line.reversedMinor += row.netMinor;
    lines.set(row.currency, line);
  }
  return [...lines.values()];
}
