/**
 * Membership plans and what they entitle. Derived on every read from
 * (plan, subscription status) — never stored on the user — so a cancelled
 * member loses Pro on the next request.
 */
export const FEATURES = ["ask_ai", "seller_analytics", "priority_review"] as const;
export type Feature = (typeof FEATURES)[number];

export const PLANS = {
  free: { name: "Free", priceMinor: 0, features: ["ask_ai"] as Feature[], quotas: { aiMessages: 20 } },
  pro: {
    name: "Pro",
    priceMinor: 900,
    features: ["ask_ai", "seller_analytics", "priority_review"] as Feature[],
    quotas: { aiMessages: 1_000 },
  },
} as const;

export type PlanKey = keyof typeof PLANS;
export type QuotaKey = keyof (typeof PLANS)["free"]["quotas"];

export function isPlanKey(v: unknown): v is PlanKey {
  return typeof v === "string" && v in PLANS;
}

export interface Entitlements {
  planKey: PlanKey;
  features: readonly Feature[];
  quotas: Readonly<Record<QuotaKey, number>>;
}

/** PAST_DUE keeps Pro on purpose: a failed renewal is dunning, not a lockout. */
const PAID_ACCESS = new Set(["ACTIVE", "PAST_DUE"]);

export function entitlementsFor(planKey: string | null | undefined, status: string | null | undefined): Entitlements {
  const key: PlanKey = isPlanKey(planKey) && status && PAID_ACCESS.has(status) ? planKey : "free";
  return { planKey: key, features: PLANS[key].features, quotas: PLANS[key].quotas };
}

export const canUse = (e: Entitlements, f: Feature) => e.features.includes(f);
