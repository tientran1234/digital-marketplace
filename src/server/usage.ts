import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const currentPeriod = (now = new Date()) => now.toISOString().slice(0, 7);

/** Increment in the database, never read-then-write in Node. */
export async function meter(userId: string, feature: string, limit: number, n = 1): Promise<{ used: number; limit: number; allowed: boolean }> {
  const period = currentPeriod();
  const key = { userId_feature_period: { userId, feature, period } };
  let used: number;
  try {
    used = (await db.usageCounter.upsert({ where: key, create: { userId, feature, period, used: n }, update: { used: { increment: n } } })).used;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    used = (await db.usageCounter.update({ where: key, data: { used: { increment: n } } })).used;
  }
  return { used, limit, allowed: used <= limit };
}
