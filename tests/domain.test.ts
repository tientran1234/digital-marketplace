import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, canTransitionOrder, orderPredecessorsOf, orderStatusForEvent } from "@/domain/order";
import { canTransitionSubscription, subscriptionStatusForEvent } from "@/domain/subscription";
import { canUse, entitlementsFor } from "@/domain/plans";
import { downloadAccess } from "@/domain/access";
import { PURCHASE_STATUSES, analyticsAccess, countsAsPurchase, countsAsView, totals } from "@/domain/analytics";

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
