/**
 * One command for a fresh database: Prisma schema (creates the vector
 * extension too) plus durable-workflow's own table.
 */
import { execSync } from "node:child_process";
import { Pool } from "pg";
import { PostgresStore } from "durable-workflow/postgres";

execSync("prisma db push --skip-generate", { stdio: "inherit" });

const url = new URL(process.env.DATABASE_URL!);
url.searchParams.delete("schema");
const pool = new Pool({ connectionString: url.toString() });
await new PostgresStore(pool).ensureSchema();
await pool.end();
console.log("workflow_runs table ready");
