/**
 * The only place an order or subscription status changes.
 * Claim the event id first (the insert is the lock), then transition with a
 * conditional UPDATE so two racing deliveries produce one winner.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { BillingEvent } from "@/domain/billing-event";
import { orderPredecessorsOf, orderStatusForEvent } from "@/domain/order";
import { subscriptionPredecessorsOf, subscriptionStatusForEvent } from "@/domain/subscription";
import { entitlementsFor, type Entitlements } from "@/domain/plans";
import { billingProvider } from "./provider";

export type ApplyOutcome = "duplicate" | "ignored" | "not_found" | "transitioned" | "renewed" | "no_transition";

export async function startOrderCheckout(userId: string, productId: string): Promise<{ orderId: string; checkoutUrl: string }> {
  const [user, product] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId } }),
    db.product.findUniqueOrThrow({ where: { id: productId } }),
  ]);
  if (product.status !== "PUBLISHED") throw new Error("product is not published");
  if (product.priceMinor === 0) throw new Error("free products are not purchased");

  // PENDING is persisted before the provider call so an early webhook finds it.
  const order = await db.order.create({
    data: { buyerId: userId, productId, amountMinor: product.priceMinor, currency: product.currency, status: "PENDING", provider: billingProvider().name },
  });
  const { checkoutUrl, checkoutRef } = await billingProvider().createCheckout({
    mode: "payment",
    ref: order.id,
    amountMinor: product.priceMinor,
    currency: product.currency,
    description: product.title,
    customerEmail: user.email,
    successUrl: `${env().APP_URL}/billing/success?order=${order.id}`,
    cancelUrl: `${env().APP_URL}/billing/cancel`,
  });
  await db.order.update({ where: { id: order.id }, data: { checkoutRef } });
  return { orderId: order.id, checkoutUrl };
}

export async function startSubscriptionCheckout(userId: string, planKey: "pro"): Promise<{ subscriptionId: string; checkoutUrl: string }> {
  const priceRef = env().STRIPE_PRICE_PRO;
  if (!priceRef) throw new Error("STRIPE_PRICE_PRO is not set");
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const sub = await db.subscription.create({ data: { userId, planKey, status: "PENDING", provider: billingProvider().name } });
  const { checkoutUrl, checkoutRef } = await billingProvider().createCheckout({
    mode: "subscription",
    ref: sub.id,
    priceRef,
    customerEmail: user.email,
    successUrl: `${env().APP_URL}/billing/success`,
    cancelUrl: `${env().APP_URL}/billing/cancel`,
  });
  await db.subscription.update({ where: { id: sub.id }, data: { checkoutRef } });
  return { subscriptionId: sub.id, checkoutUrl };
}

export async function applyEvent(providerName: string, event: BillingEvent): Promise<ApplyOutcome> {
  try {
    await db.webhookEvent.create({ data: { providerEventId: event.providerEventId, provider: providerName, type: event.type } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "duplicate";
    throw err;
  }

  const refs = [
    event.providerRef ? { providerRef: event.providerRef } : null,
    event.checkoutRef ? { checkoutRef: event.checkoutRef } : null,
  ].filter((r): r is { providerRef: string } | { checkoutRef: string } => r !== null);
  if (refs.length === 0) return event.type === "unknown" ? "ignored" : "not_found";

  const orderTarget = orderStatusForEvent(event.type);
  if (orderTarget) {
    const order = await db.order.findFirst({ where: { OR: refs } });
    if (!order) return "not_found";
    const { count } = await db.order.updateMany({
      where: { id: order.id, status: { in: orderPredecessorsOf(orderTarget) } },
      data: { status: orderTarget, ...(event.providerRef ? { providerRef: event.providerRef } : {}) },
    });
    return count === 1 ? "transitioned" : "no_transition";
  }

  const subTarget = subscriptionStatusForEvent(event.type);
  if (subTarget) {
    const sub = await db.subscription.findFirst({ where: { OR: refs } });
    if (!sub) return "not_found";
    const { count } = await db.subscription.updateMany({
      where: { id: sub.id, status: { in: subscriptionPredecessorsOf(subTarget) } },
      data: {
        status: subTarget,
        ...(event.providerRef ? { providerRef: event.providerRef } : {}),
        ...(event.currentPeriodEnd ? { currentPeriodEnd: event.currentPeriodEnd } : {}),
      },
    });
    if (count === 1) return "transitioned";
    if (subTarget === "ACTIVE" && sub.status === "ACTIVE" && event.currentPeriodEnd) {
      await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: event.currentPeriodEnd } });
      return "renewed";
    }
    return "no_transition";
  }

  return "ignored";
}

export async function entitlementsForUser(userId: string | null): Promise<Entitlements> {
  if (!userId) return entitlementsFor("free", null);
  const sub = await db.subscription.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  return entitlementsFor(sub?.planKey, sub?.status);
}
