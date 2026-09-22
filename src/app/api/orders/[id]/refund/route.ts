import { db } from "@/lib/db";
import { requireUser } from "@/server/auth";
import { handle, type Params } from "@/server/http";
import { engine, refundRequest } from "@/server/workflows";

export const runtime = "nodejs";

/** Buyer asks for a refund → a durable workflow waits for an admin decision. */
export const POST = handle<Params<"id">>(async (_request, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  const order = await db.order.findUniqueOrThrow({ where: { id } });
  if (order.buyerId !== user.id) return Response.json({ error: "not your order" }, { status: 403 });
  if (order.status !== "PAID") return Response.json({ error: `order is ${order.status}` }, { status: 409 });

  const runId = await engine().start(refundRequest, { orderId: id }, { id: `refund:${id}` });
  const run = await engine().tick(runId);
  return Response.json({ runId, status: run.status }, { status: 201 });
});
