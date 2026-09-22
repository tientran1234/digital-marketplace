import { startSubscriptionCheckout } from "@/server/billing";
import { requireUser } from "@/server/auth";
import { handle } from "@/server/http";

export const runtime = "nodejs";
export const POST = handle(async () => {
  const user = await requireUser();
  return Response.json(await startSubscriptionCheckout(user.id, "pro"), { status: 201 });
});
