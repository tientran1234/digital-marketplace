import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { adminAllowed } from "@/server/license";
import { engine } from "@/server/workflows";

export const runtime = "nodejs";
const Body = z.object({ productId: z.string().min(1), approved: z.boolean(), reason: z.string().max(500).optional() });

export const POST = handle(async (request) => {
  await requireUser(["ADMIN"]);
  if (!adminAllowed()) return Response.json({ error: "admin is not licensed on this install" }, { status: 403 });
  const { productId, approved, reason } = await json(request, Body);
  const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
  if (!product.reviewRunId) return Response.json({ error: "no review in progress" }, { status: 409 });
  const run = await engine().signal(product.reviewRunId, "review", { approved, reason });
  return Response.json({ runId: run.id, status: run.status, output: run.output });
});
