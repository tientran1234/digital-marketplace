import type { BillingEventType } from "./billing-event";

export const SUBSCRIPTION_STATUSES = ["PENDING", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

const ALLOWED: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  PENDING: ["ACTIVE", "EXPIRED"],
  ACTIVE: ["PAST_DUE", "CANCELED"],
  PAST_DUE: ["ACTIVE", "CANCELED", "EXPIRED"],
  CANCELED: [],
  EXPIRED: [],
};

export function canTransitionSubscription(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}
export function subscriptionPredecessorsOf(to: SubscriptionStatus): SubscriptionStatus[] {
  return SUBSCRIPTION_STATUSES.filter((from) => canTransitionSubscription(from, to));
}
export function subscriptionStatusForEvent(type: BillingEventType): SubscriptionStatus | null {
  switch (type) {
    case "subscription_activated":
      return "ACTIVE";
    case "subscription_payment_failed":
      return "PAST_DUE";
    case "subscription_canceled":
      return "CANCELED";
    default:
      return null;
  }
}
