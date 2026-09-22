import { Pool } from "pg";
import { env } from "./env";

/** A raw pg pool for the parts Prisma cannot express: pgvector queries and durable-workflow's store. */
const globalForPg = globalThis as unknown as { pgPool?: Pool };
export function pool(): Pool {
  if (!globalForPg.pgPool) {
    // Prisma's `?schema=` parameter is not a libpq option; strip it.
    const url = new URL(env().DATABASE_URL);
    url.searchParams.delete("schema");
    globalForPg.pgPool = new Pool({ connectionString: url.toString(), max: 5 });
  }
  return globalForPg.pgPool;
}
