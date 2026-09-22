import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, canTransitionOrder, orderPredecessorsOf, orderStatusForEvent } from "@/domain/order";
import { canTransitionSubscription, subscriptionStatusForEvent } from "@/domain/subscription";
import { canUse, entitlementsFor } from "@/domain/plans";
import { downloadAccess } from "@/domain/access";

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
