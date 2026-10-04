/**
 * Buyer reviews: the rows, the queue an admin reads, and the averages the
 * listings show. Every status change goes through the same kind of conditional
 * UPDATE an order's does, so two moderators deciding at once leave one winner.
 *
 * No workflow here. A listing's review waits for days and times out, and a
 * refund calls a provider that can fail — a rating waits for nothing and moves
 * no money, so the queue is the PENDING rows themselves rather than a run.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  NO_RATINGS,
  ratingSummary,
  reviewEligibility,
  reviewPredecessorsOf,
  type RatingSummary,
  type ReviewEligibility,
  type ReviewRefusal,
  type ReviewStatus,
} from "@/domain/review";

/** Which of this buyer's purchases of this product may still be reviewed. */
export async function reviewEligibilityFor(productId: string, userId: string | null): Promise<ReviewEligibility> {
  if (!userId) return reviewEligibility({ userId: null, orders: [] });
  const orders = await db.order.findMany({
    where: { buyerId: userId, productId },
    select: { id: true, status: true, review: { select: { id: true } } },
  });
  return reviewEligibility({ userId, orders: orders.map((o) => ({ id: o.id, status: o.status, reviewed: o.review !== null })) });
}

export type SubmitOutcome = { submitted: true; reviewId: string } | { submitted: false; reason: ReviewRefusal };

/**
 * Take a rating for one purchase. Eligibility is decided here rather than
 * trusted from the page that drew the form, and the unique orderId catches the
 * double submit the check cannot: two requests both find the purchase unspoken,
 * and only one of them gets a row.
 */
export async function submitReview(input: { orderId: string; userId: string; rating: number; body?: string }): Promise<SubmitOutcome> {
  const order = await db.order.findUnique({ where: { id: input.orderId }, select: { id: true, buyerId: true, status: true, productId: true, review: { select: { id: true } } } });
  // Someone else's order is not news that an order exists, so it reads as the
  // same "you have not bought this" an unpurchased product gives.
  if (!order || order.buyerId !== input.userId) return { submitted: false, reason: "not_purchased" };
  const decision = reviewEligibility({ userId: input.userId, orders: [{ id: order.id, status: order.status, reviewed: order.review !== null }] });
  if (!decision.allowed) return { submitted: false, reason: decision.reason };

  try {
    const review = await db.review.create({
      data: {
        orderId: order.id,
        productId: order.productId,
        buyerId: input.userId,
        rating: input.rating,
        body: input.body?.trim() || null,
        status: "PENDING" satisfies ReviewStatus,
      },
    });
    return { submitted: true, reviewId: review.id };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    return { submitted: false, reason: "already_reviewed" };
  }
}

/** Forward-only: the conditional UPDATE is the lock, exactly as it is for orders and payouts. */
async function transition(reviewId: string, to: ReviewStatus): Promise<boolean> {
  const { count } = await db.review.updateMany({ where: { id: reviewId, status: { in: reviewPredecessorsOf(to) } }, data: { status: to } });
  return count === 1;
}

/** @returns false when this review had already been decided. */
export const moderateReview = (reviewId: string, approved: boolean) => transition(reviewId, approved ? "PUBLISHED" : "REJECTED");

/** The admin queue, oldest first: a buyer who waited longest is read first. */
export function pendingReviews() {
  return db.review.findMany({
    where: { status: "PENDING" satisfies ReviewStatus },
    orderBy: { createdAt: "asc" },
    include: { product: { select: { title: true, slug: true } }, buyer: { select: { name: true } } },
  });
}

/** What the product page shows: the ones a human let through, newest first. */
export function publishedReviews(productId: string, take = 20) {
  return db.review.findMany({
    where: { productId, status: "PUBLISHED" satisfies ReviewStatus },
    orderBy: { createdAt: "desc" },
    take,
    include: { buyer: { select: { name: true } } },
  });
}

/**
 * One grouped query for the whole grid, so a listing nobody has rated costs no
 * extra round trip — and comes back as no rating rather than as a zero.
 */
export async function productRatings(productIds: readonly string[]): Promise<Map<string, RatingSummary>> {
  if (productIds.length === 0) return new Map();
  const rows = await db.review.groupBy({
    by: ["productId"],
    where: { productId: { in: [...productIds] }, status: "PUBLISHED" satisfies ReviewStatus },
    _count: { _all: true },
    _sum: { rating: true },
  });
  return new Map(rows.map((r) => [r.productId, ratingSummary({ count: r._count._all, sumOfRatings: r._sum.rating ?? 0 })]));
}

export async function productRating(productId: string): Promise<RatingSummary> {
  return (await productRatings([productId])).get(productId) ?? NO_RATINGS;
}
