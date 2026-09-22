import { db } from "@/lib/db";
import { requireUser } from "@/server/auth";
import { handle, type Params } from "@/server/http";
import { engine, productReview } from "@/server/workflows";

export const runtime = "nodejs";

/** Send a DRAFT to review. Starts the durable review workflow and runs its first step now. */
export const POST = handle<Params<"id">>(async (_request, { params }) => {
  const user = await requireUser(["SELLER", "ADMIN"]);
  const { id } = await params;
  const product = await db.product.findUniqueOrThrow({ where: { id } });
  if (product.sellerId !== user.id && user.role !== "ADMIN") return Response.json({ error: "not your product" }, { status: 403 });
  if (product.status !== "DRAFT" && product.status !== "REJECTED") return Response.json({ error: `cannot submit a ${product.status} product` }, { status: 409 });
  if (!product.fileKey) return Response.json({ error: "upload a document first" }, { status: 409 });

  const runId = await engine().start(productReview, { productId: id });
  const run = await engine().tick(runId);
  return Response.json({ runId, status: run.status });
});
