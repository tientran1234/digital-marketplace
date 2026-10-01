/**
 * One known database per run: the demo seed, with whatever the last run left
 * behind cleared out first. A spec can then assert on a count — the buyer's
 * quota, the product's orders — instead of on a delta, and a run that fails
 * half way through does not poison the next one.
 */
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { db } from "@/lib/db";

const repo = fileURLToPath(new URL("..", import.meta.url));

export default async function seed() {
  // Users and products cascade to sessions, orders, chunks and views; these
  // three hang off nothing and would survive.
  await db.webhookEvent.deleteMany();
  await db.agentTrace.deleteMany();
  await db.loginToken.deleteMany();
  await db.product.deleteMany();
  await db.user.deleteMany();

  // The seed a fresh install runs, not a copy of it: the suite buys the
  // product the README tells you to buy and asks about the document the eval
  // suite asks about.
  await promisify(execFile)("pnpm", ["db:seed"], { cwd: repo });
  await db.$disconnect();
}
