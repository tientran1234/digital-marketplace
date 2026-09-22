import { env } from "@/lib/env";
import { engine } from "@/server/workflows";

export const runtime = "nodejs";

/**
 * The worker, for platforms with no resident process. Call it on a schedule
 * (Vercel Cron: see vercel.json). Protected by a shared secret.
 */
async function tick(request: Request) {
  const secret = env().WORKFLOW_TICK_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const executed = await engine().processDue(20);
  return Response.json({ executed });
}
export const GET = tick;
export const POST = tick;
