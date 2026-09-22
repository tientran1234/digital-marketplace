import { z } from "zod";
import { db } from "@/lib/db";
import { askAboutProduct } from "@/server/assistant";
import { requireUser } from "@/server/auth";
import { handle, json, type Params } from "@/server/http";
import type { AgentEvent } from "agent-runtime";

export const runtime = "nodejs";
const Body = z.object({ question: z.string().min(1).max(2000) });

/** Streams the agent's events as SSE: text_delta, tool_call, tool_result, done. */
export const POST = handle<Params<"id">>(async (request, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  const { question } = await json(request, Body);
  const product = await db.product.findUniqueOrThrow({ where: { id }, include: { seller: { select: { name: true } } } });
  if (product.status !== "PUBLISHED" && product.sellerId !== user.id && user.role !== "ADMIN") {
    return Response.json({ error: "not published" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AgentEvent | { type: "error"; message: string }) =>
        controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      try {
        await askAboutProduct({ user, product, question, onEvent: send });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
});
