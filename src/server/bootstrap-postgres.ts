import type { PrismaClient } from "@prisma/client";
import type { Pool, PoolClient } from "pg";
import { seedOnFirstBoot, type SeedGate } from "@/server/bootstrap";
import { seedDemoData } from "@/server/seed";
import { db } from "@/lib/db";
import { pool } from "@/lib/pg";

/**
 * The Postgres side of the first-boot seed, kept apart from the rules in
 * `bootstrap.ts` because `instrumentation.ts` is compiled for the edge runtime
 * as well and there is no database driver there. Reached only through the
 * dynamic import that file guards with `NEXT_RUNTIME`.
 */

/**
 * Any constant: it only has to be a number no other advisory lock in this
 * database uses, and durable-workflow's store leases its runs with rows.
 */
const SEED_LOCK_KEY = 8_164_201;

/**
 * A Postgres advisory lock for the claim, the product table for emptiness.
 *
 * The lock is taken on one connection out of the pool and kept there, because
 * it is session-scoped — taken on whichever connection the pool happened to
 * hand out, it is a lock nobody can reliably release. That scope is also why
 * it is a lock rather than a row: an instance killed mid-seed drops it when
 * its connection goes, where a row would stay behind and no later boot would
 * ever retry.
 */
export function postgresSeedGate(pg: Pool, prisma: PrismaClient): SeedGate {
  let held: PoolClient | null = null;
  return {
    async claim() {
      const client = await pg.connect();
      try {
        const { rows } = await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [SEED_LOCK_KEY]);
        if (!rows[0]?.locked) {
          client.release();
          return false;
        }
        held = client;
        return true;
      } catch (error) {
        client.release();
        throw error;
      }
    },
    async release() {
      const client = held;
      if (!client) return;
      held = null;
      try {
        await client.query("select pg_advisory_unlock($1)", [SEED_LOCK_KEY]);
      } finally {
        client.release();
      }
    },
    async isEmpty() {
      return (await prisma.product.count()) === 0;
    },
    async seed() {
      await seedDemoData(prisma, (line) => console.log(`[seed] ${line}`));
    },
  };
}

export async function seedThisDeployment(): Promise<void> {
  try {
    console.log(`[seed] first boot: ${await seedOnFirstBoot(postgresSeedGate(pool(), db))}`);
  } catch (error) {
    // A deployment that cannot seed is still a deployment that can serve: the
    // marketplace comes up empty and says so, which is a better failure than
    // every instance refusing to boot over demo data.
    console.error("[seed] first boot failed, serving anyway", error);
  }
}
