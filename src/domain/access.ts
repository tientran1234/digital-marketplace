/**
 * Who may download a product. One pure function, used by the download route
 * and the product page, so the button and the file can never disagree.
 */
export interface AccessContext {
  userId: string | null;
  role: "BUYER" | "SELLER" | "ADMIN" | null;
  product: { sellerId: string; priceMinor: number; status: string };
  /** Statuses of this user's orders for this product. */
  orderStatuses: readonly string[];
}

export type AccessDecision =
  | { allowed: true; reason: "free" | "purchased" | "owner" | "admin" }
  | { allowed: false; reason: "unpublished" | "not_purchased" | "anonymous" };

export function downloadAccess(ctx: AccessContext): AccessDecision {
  if (ctx.role === "ADMIN") return { allowed: true, reason: "admin" };
  if (ctx.userId && ctx.userId === ctx.product.sellerId) return { allowed: true, reason: "owner" };
  if (ctx.product.status !== "PUBLISHED") return { allowed: false, reason: "unpublished" };
  if (ctx.product.priceMinor === 0) return { allowed: true, reason: "free" };
  if (!ctx.userId) return { allowed: false, reason: "anonymous" };
  if (ctx.orderStatuses.includes("PAID")) return { allowed: true, reason: "purchased" };
  return { allowed: false, reason: "not_purchased" };
}
