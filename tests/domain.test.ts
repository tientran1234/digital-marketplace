import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, canTransitionOrder, orderPredecessorsOf, orderStatusForEvent } from "@/domain/order";
import { canTransitionSubscription, subscriptionStatusForEvent } from "@/domain/subscription";
import { canUse, entitlementsFor } from "@/domain/plans";
import { downloadAccess } from "@/domain/access";
import { PURCHASE_STATUSES, analyticsAccess, countsAsPurchase, countsAsView, totals } from "@/domain/analytics";
import {
  NO_RATINGS,
  RATING_MAX,
  RATING_MIN,
  REVIEW_STATUSES,
  canTransitionReview,
  ratingSummary,
  reviewEligibility,
  reviewPredecessorsOf,
} from "@/domain/review";
import {
  PAYOUT_STATUSES,
  PLATFORM_FEE_BPS,
  canTransitionPayout,
  payoutPredecessorsOf,
  payoutReadiness,
  payoutTotals,
  splitPayment,
} from "@/domain/payout";

describe("order state machine", () => {
  it("is forward-only", () => {
    expect(canTransitionOrder("PENDING", "PAID")).toBe(true);
    expect(canTransitionOrder("PAID", "PENDING")).toBe(false);
    for (const to of ORDER_STATUSES) {
      expect(canTransitionOrder("REFUNDED", to)).toBe(false);
      expect(canTransitionOrder("EXPIRED", to)).toBe(false);
    }
  });
  it("cannot pay the same order twice", () => {
    expect(orderPredecessorsOf("PAID")).toEqual(["PENDING"]);
  });
  it("maps events", () => {
    expect(orderStatusForEvent("order_paid")).toBe("PAID");
    expect(orderStatusForEvent("order_refunded")).toBe("REFUNDED");
    expect(orderStatusForEvent("subscription_activated")).toBeNull();
  });
});

describe("subscription state machine", () => {
  it("allows the dunning round trip and nothing after cancel", () => {
    expect(canTransitionSubscription("ACTIVE", "PAST_DUE")).toBe(true);
    expect(canTransitionSubscription("PAST_DUE", "ACTIVE")).toBe(true);
    expect(canTransitionSubscription("CANCELED", "ACTIVE")).toBe(false);
    expect(subscriptionStatusForEvent("order_paid")).toBeNull();
  });
});

describe("entitlements", () => {
  it("gives Pro to active and past-due, Free to everything else", () => {
    expect(entitlementsFor("pro", "ACTIVE").planKey).toBe("pro");
    expect(entitlementsFor("pro", "PAST_DUE").planKey).toBe("pro");
    expect(entitlementsFor("pro", "CANCELED").planKey).toBe("free");
    expect(entitlementsFor(undefined, undefined).planKey).toBe("free");
    expect(canUse(entitlementsFor("pro", "ACTIVE"), "seller_analytics")).toBe(true);
    expect(canUse(entitlementsFor("free", "ACTIVE"), "seller_analytics")).toBe(false);
  });
});

describe("download access", () => {
  const product = { sellerId: "s1", priceMinor: 1000, status: "PUBLISHED" };
  it("admin and owner always; buyers only after a PAID order", () => {
    expect(downloadAccess({ userId: "a", role: "ADMIN", product, orderStatuses: [] })).toMatchObject({ allowed: true, reason: "admin" });
    expect(downloadAccess({ userId: "s1", role: "SELLER", product, orderStatuses: [] })).toMatchObject({ allowed: true, reason: "owner" });
    expect(downloadAccess({ userId: "b", role: "BUYER", product, orderStatuses: ["PENDING"] })).toMatchObject({ allowed: false, reason: "not_purchased" });
    expect(downloadAccess({ userId: "b", role: "BUYER", product, orderStatuses: ["PAID"] })).toMatchObject({ allowed: true, reason: "purchased" });
    expect(downloadAccess({ userId: "b", role: "BUYER", product, orderStatuses: ["REFUNDED"] })).toMatchObject({ allowed: false });
  });
  it("free products need no purchase but do need to be published", () => {
    expect(downloadAccess({ userId: null, role: null, product: { ...product, priceMinor: 0 }, orderStatuses: [] })).toMatchObject({ allowed: true, reason: "free" });
    expect(downloadAccess({ userId: "b", role: "BUYER", product: { ...product, priceMinor: 0, status: "DRAFT" }, orderStatuses: [] })).toMatchObject({ allowed: false, reason: "unpublished" });
  });
});

describe("seller analytics", () => {
  const pro = entitlementsFor("pro", "ACTIVE");
  const free = entitlementsFor("free", null);

  it("is a Pro feature, and only for someone with listings", () => {
    expect(analyticsAccess("SELLER", pro)).toEqual({ allowed: true });
    expect(analyticsAccess("SELLER", free)).toMatchObject({ allowed: false, reason: "needs_pro" });
    expect(analyticsAccess("BUYER", pro)).toMatchObject({ allowed: false, reason: "not_a_seller" });
    expect(analyticsAccess(null, pro)).toMatchObject({ allowed: false, reason: "not_a_seller" });
  });

  it("counts a sale only while the money has stayed", () => {
    expect(PURCHASE_STATUSES).toEqual(["PAID"]);
    expect(countsAsPurchase("PENDING")).toBe(false);
    expect(countsAsPurchase("EXPIRED")).toBe(false);
    expect(countsAsPurchase("REFUNDED")).toBe(false);
  });

  it("does not count the seller looking at their own listing", () => {
    expect(countsAsView("s1", "s1")).toBe(false);
    expect(countsAsView("b1", "s1")).toBe(true);
    expect(countsAsView(null, "s1")).toBe(true);
  });

  it("adds the columns up, and has zeros to show for a seller with nothing", () => {
    expect(totals([])).toEqual({ views: 0, purchases: 0, questions: 0 });
    expect(
      totals([
        { productId: "p1", slug: "a", title: "A", views: 12, purchases: 2, questions: 5 },
        { productId: "p2", slug: "b", title: "B", views: 3, purchases: 0, questions: 1 },
      ]),
    ).toEqual({ views: 15, purchases: 2, questions: 6 });
  });
});

describe("payout split", () => {
  it("keeps the platform's cut and leaves the rest", () => {
    expect(splitPayment(1900)).toEqual({ grossMinor: 1900, feeMinor: 190, netMinor: 1710 });
    expect(PLATFORM_FEE_BPS).toBe(1_000);
  });

  /** The invariant the transfer depends on: we can never send out more than came in. */
  it("adds back up to the gross at every amount, with the rounding in the seller's favour", () => {
    for (const gross of [0, 1, 7, 99, 101, 999, 1900, 123_457]) {
      const { feeMinor, netMinor } = splitPayment(gross);
      expect(feeMinor + netMinor).toBe(gross);
      expect(feeMinor).toBe(Math.floor((gross * PLATFORM_FEE_BPS) / 10_000));
      expect(netMinor).toBeGreaterThanOrEqual(feeMinor === 0 ? gross : 0);
    }
  });
});

describe("payout state machine", () => {
  it("is forward-only, and a refund either cancels or reverses depending on what moved", () => {
    expect(canTransitionPayout("PENDING", "PAID")).toBe(true);
    expect(canTransitionPayout("PENDING", "CANCELED")).toBe(true);
    expect(canTransitionPayout("PAID", "REVERSED")).toBe(true);
    // Nothing left the platform for a cancelled payout, so there is nothing to reverse.
    expect(canTransitionPayout("CANCELED", "REVERSED")).toBe(false);
    expect(canTransitionPayout("PAID", "CANCELED")).toBe(false);
    for (const to of PAYOUT_STATUSES) {
      expect(canTransitionPayout("REVERSED", to)).toBe(false);
      expect(canTransitionPayout("CANCELED", to)).toBe(false);
    }
  });
  it("cannot pay the same payout twice, or reverse one that was never sent", () => {
    expect(payoutPredecessorsOf("PAID")).toEqual(["PENDING"]);
    expect(payoutPredecessorsOf("REVERSED")).toEqual(["PAID"]);
    expect(payoutPredecessorsOf("CANCELED")).toEqual(["PENDING"]);
  });
});

describe("payout readiness", () => {
  it("needs an account that finished onboarding", () => {
    expect(payoutReadiness(null)).toMatchObject({ ready: false, reason: "no_account" });
    expect(payoutReadiness({ payoutsEnabled: false })).toMatchObject({ ready: false, reason: "onboarding_incomplete" });
    expect(payoutReadiness({ payoutsEnabled: true })).toMatchObject({ ready: true });
  });
});

describe("payout totals", () => {
  const row = (status: string, netMinor: number, currency = "usd") => ({ status, netMinor, currency });
  it("adds each currency up on its own and counts a cancelled payout nowhere", () => {
    expect(payoutTotals([row("PENDING", 900), row("PAID", 1710), row("PAID", 90), row("REVERSED", 450), row("CANCELED", 9_999)])).toEqual([
      { currency: "usd", pendingMinor: 900, paidMinor: 1800, reversedMinor: 450 },
    ]);
    expect(payoutTotals([row("PAID", 100), row("PAID", 200, "vnd")])).toEqual([
      { currency: "usd", pendingMinor: 0, paidMinor: 100, reversedMinor: 0 },
      { currency: "vnd", pendingMinor: 0, paidMinor: 200, reversedMinor: 0 },
    ]);
    expect(payoutTotals([])).toEqual([]);
  });
});

describe("review eligibility", () => {
  const paid = { id: "o1", status: "PAID", reviewed: false };

  it("needs a purchase of your own that is still a purchase", () => {
    expect(reviewEligibility({ userId: null, orders: [paid] })).toMatchObject({ allowed: false, reason: "anonymous" });
    expect(reviewEligibility({ userId: "b", orders: [] })).toMatchObject({ allowed: false, reason: "not_purchased" });
    expect(reviewEligibility({ userId: "b", orders: [{ ...paid, status: "PENDING" }] })).toMatchObject({ allowed: false, reason: "not_purchased" });
    // The refund took the product back, so it took the right to review it back.
    expect(reviewEligibility({ userId: "b", orders: [{ ...paid, status: "REFUNDED" }] })).toMatchObject({ allowed: false, reason: "not_purchased" });
    expect(reviewEligibility({ userId: "b", orders: [paid] })).toEqual({ allowed: true, orderId: "o1" });
  });

  /** One review per purchase is the whole rule: the second one needs a second sale. */
  it("names the purchase that has not spoken yet, and refuses when none is left", () => {
    expect(reviewEligibility({ userId: "b", orders: [{ ...paid, reviewed: true }] })).toMatchObject({ allowed: false, reason: "already_reviewed" });
    expect(
      reviewEligibility({ userId: "b", orders: [{ ...paid, reviewed: true }, { id: "o2", status: "PAID", reviewed: false }] }),
    ).toEqual({ allowed: true, orderId: "o2" });
  });
});

describe("review state machine", () => {
  it("is forward-only, and a moderator's decision is the end of it", () => {
    expect(canTransitionReview("PENDING", "PUBLISHED")).toBe(true);
    expect(canTransitionReview("PENDING", "REJECTED")).toBe(true);
    for (const to of REVIEW_STATUSES) {
      expect(canTransitionReview("PUBLISHED", to)).toBe(false);
      expect(canTransitionReview("REJECTED", to)).toBe(false);
    }
  });

  /** The conditional UPDATE leans on this: two admins clicking leave one winner. */
  it("cannot decide the same review twice", () => {
    expect(reviewPredecessorsOf("PUBLISHED")).toEqual(["PENDING"]);
    expect(reviewPredecessorsOf("REJECTED")).toEqual(["PENDING"]);
    expect(reviewPredecessorsOf("PENDING")).toEqual([]);
  });
});

describe("rating summary", () => {
  it("has no number for a product nobody has rated", () => {
    expect(ratingSummary({ count: 0, sumOfRatings: 0 })).toEqual(NO_RATINGS);
    expect(NO_RATINGS.average).toBeNull();
  });

  it("rounds to one decimal, in one place, so every view shows the same number", () => {
    expect(ratingSummary({ count: 4, sumOfRatings: 17 })).toEqual({ count: 4, average: 4.3 });
    expect(ratingSummary({ count: 3, sumOfRatings: 12 })).toEqual({ count: 3, average: 4 });
    expect(ratingSummary({ count: 1, sumOfRatings: RATING_MAX })).toEqual({ count: 1, average: 5 });
    expect(ratingSummary({ count: 2, sumOfRatings: RATING_MIN * 2 })).toEqual({ count: 2, average: 1 });
  });

  it("keeps the average inside the scale it was rated on", () => {
    for (const [count, sum] of [[1, 1], [7, 21], [10, 50], [3, 7]]) {
      const { average } = ratingSummary({ count, sumOfRatings: sum });
      expect(average).toBeGreaterThanOrEqual(RATING_MIN);
      expect(average).toBeLessThanOrEqual(RATING_MAX);
    }
  });
});
