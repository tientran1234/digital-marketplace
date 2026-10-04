/**
 * What a review is worth and who has earned the right to leave one. Pure, so
 * the form on the product page, the route that accepts it and the average on
 * the card all read the same rules instead of each guessing at them.
 */
import type { OrderStatus } from "./order";

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/**
 * The purchase a review is earned by, spelled out against the order's own
 * statuses so a renamed one fails the build. A refund gives the product back,
 * so it gives the right to review it back too; an order that never got past
 * PENDING bought nothing in the first place.
 */
const EARNS_A_REVIEW: OrderStatus = "PAID";

/** A review's life. Forward-only, and a decision is the end of it. */
export const REVIEW_STATUSES = ["PENDING", "PUBLISHED", "REJECTED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

const ALLOWED: Record<ReviewStatus, ReviewStatus[]> = {
  PENDING: ["PUBLISHED", "REJECTED"],
  PUBLISHED: [],
  REJECTED: [],
};

export function canTransitionReview(from: ReviewStatus, to: ReviewStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}
export function reviewPredecessorsOf(to: ReviewStatus): ReviewStatus[] {
  return REVIEW_STATUSES.filter((from) => canTransitionReview(from, to));
}

/** This buyer's orders for one product, and whether each already said its piece. */
export interface ReviewContext {
  userId: string | null;
  orders: readonly { id: string; status: string; reviewed: boolean }[];
}

export type ReviewEligibility =
  | { allowed: true; orderId: string }
  | { allowed: false; reason: "anonymous" | "not_purchased" | "already_reviewed" };

/**
 * Which purchase this buyer may review, if any. One review per purchase rather
 * than per buyer: someone who bought the document twice has two sales to
 * report on, and the orderId the decision names is what the row is keyed by.
 */
export function reviewEligibility(ctx: ReviewContext): ReviewEligibility {
  if (!ctx.userId) return { allowed: false, reason: "anonymous" };
  const earned = ctx.orders.filter((o) => o.status === EARNS_A_REVIEW);
  if (earned.length === 0) return { allowed: false, reason: "not_purchased" };
  const unspoken = earned.find((o) => !o.reviewed);
  if (!unspoken) return { allowed: false, reason: "already_reviewed" };
  return { allowed: true, orderId: unspoken.id };
}

export interface RatingSummary {
  count: number;
  /** null when nobody has rated it: a product with no reviews is not a zero. */
  average: number | null;
}

export const NO_RATINGS: RatingSummary = { count: 0, average: null };

/**
 * The number under a product's title, rounded here rather than in each view so
 * the card and the product page cannot show the same reviews as 4.3 and 4.25.
 * The tally counts published rows only — the average is what a human let
 * through, not what was typed.
 */
export function ratingSummary(tally: { count: number; sumOfRatings: number }): RatingSummary {
  if (tally.count <= 0) return NO_RATINGS;
  return { count: tally.count, average: Math.round((tally.sumOfRatings / tally.count) * 10) / 10 };
}
