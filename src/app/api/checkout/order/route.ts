import { z } from "zod";
import { startOrderCheckout } from "@/server/billing";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";

export const runtime = "nodejs";
export const POST = handle(async (request) => {
  const user = await requireUser();
  const { productId } = await json(request, z.object({ productId: z.string().min(1) }));
  return Response.json(await startOrderCheckout(user.id, productId), { status: 201 });
});
