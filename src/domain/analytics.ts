/**
 * What a seller's numbers mean. Pure, so the page, the aggregation query and
 * the view recorder cannot disagree about which rows count.
 */
import { ORDER_STATUSES, type OrderStatus } from "./order";
import { canUse, type Entitlements } from "./plans";

/** One listing's line in the report. A product with no activity is still a row, with zeros. */
export interface ProductStats {
  productId: string;
  slug: string;
  title: string;
  views: number;
  purchases: number;
  questions: number;
}

export type AnalyticsDecision = { allowed: true } | { allowed: false; reason: "not_a_seller" | "needs_pro" };

/** Pro, and only over listings of your own — the sell page asks this before it queries. */
export function analyticsAccess(role: "BUYER" | "SELLER" | "ADMIN" | null, ent: Entitlements): AnalyticsDecision {
  if (role !== "SELLER" && role !== "ADMIN") return { allowed: false, reason: "not_a_seller" };
  if (!canUse(ent, "seller_analytics")) return { allowed: false, reason: "needs_pro" };
  return { allowed: true };
}

/** A sale is money that arrived and stayed, so a refunded order is not one. */
export const countsAsPurchase = (status: string): boolean => status === "PAID";

/** Spelled out from the state machine so a new status cannot quietly become a sale. */
export const PURCHASE_STATUSES: OrderStatus[] = ORDER_STATUSES.filter(countsAsPurchase);

/** The seller reloading their own listing is not an audience. */
export const countsAsView = (viewerId: string | null, sellerId: string): boolean => viewerId !== sellerId;

export function totals(rows: readonly ProductStats[]): Pick<ProductStats, "views" | "purchases" | "questions"> {
  return rows.reduce(
    (sum, r) => ({ views: sum.views + r.views, purchases: sum.purchases + r.purchases, questions: sum.questions + r.questions }),
    { views: 0, purchases: 0, questions: 0 },
  );
}
