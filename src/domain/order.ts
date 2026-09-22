import type { BillingEventType } from "./billing-event";

/** One-time purchase status. Forward-only; enforced again by a conditional UPDATE. */
export const ORDER_STATUSES = ["PENDING", "PAID", "EXPIRED", "REFUNDED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["PAID", "EXPIRED"],
  PAID: ["REFUNDED"],
  EXPIRED: [],
  REFUNDED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}
export function orderPredecessorsOf(to: OrderStatus): OrderStatus[] {
  return ORDER_STATUSES.filter((from) => canTransitionOrder(from, to));
}
export function orderStatusForEvent(type: BillingEventType): OrderStatus | null {
  switch (type) {
    case "order_paid":
      return "PAID";
    case "order_expired":
      return "EXPIRED";
    case "order_refunded":
      return "REFUNDED";
    default:
      return null;
  }
}
