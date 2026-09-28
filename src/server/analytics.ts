/**
 * The seller's report: views, purchases and questions per listing. Three
 * grouped counts rather than one join, so a product nobody has bought or
 * asked about still comes back as a row of zeros instead of disappearing.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PURCHASE_STATUSES, countsAsView, type ProductStats } from "@/domain/analytics";

export const currentDay = (now = new Date()) => now.toISOString().slice(0, 10);

/** Increment in the database, never read-then-write in Node. */
export async function recordProductView(product: { id: string; sellerId: string }, viewerId: string | null): Promise<void> {
  if (!countsAsView(viewerId, product.sellerId)) return;
  const day = currentDay();
  const key = { productId_day: { productId: product.id, day } };
  try {
    await db.productView.upsert({ where: key, create: { productId: product.id, day, count: 1 }, update: { count: { increment: 1 } } });
  } catch (err) {
    // Two first views of the day race the same insert; the loser increments.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    await db.productView.update({ where: key, data: { count: { increment: 1 } } });
  }
}

export async function sellerAnalytics(sellerId: string): Promise<ProductStats[]> {
  const products = await db.product.findMany({ where: { sellerId }, orderBy: { createdAt: "desc" }, select: { id: true, slug: true, title: true } });
  if (products.length === 0) return [];
  const productId = { in: products.map((p) => p.id) };
  const [views, purchases, questions] = await Promise.all([
    db.productView.groupBy({ by: ["productId"], where: { productId }, _sum: { count: true } }),
    db.order.groupBy({ by: ["productId"], where: { productId, status: { in: PURCHASE_STATUSES } }, _count: { _all: true } }),
    db.agentTrace.groupBy({ by: ["productId"], where: { productId }, _count: { _all: true } }),
  ]);
  const seen = new Map(views.map((v) => [v.productId, v._sum.count ?? 0]));
  const sold = new Map(purchases.map((p) => [p.productId, p._count._all]));
  const asked = new Map(questions.map((q) => [q.productId, q._count._all]));
  return products.map((p) => ({
    productId: p.id,
    slug: p.slug,
    title: p.title,
    views: seen.get(p.id) ?? 0,
    purchases: sold.get(p.id) ?? 0,
    questions: asked.get(p.id) ?? 0,
  }));
}
