import { z } from "zod";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { adminAllowed } from "@/server/license";
import { engine } from "@/server/workflows";

export const runtime = "nodejs";
const Body = z.object({ runId: z.string().min(1), approved: z.boolean() });

export const POST = handle(async (request) => {
  await requireUser(["ADMIN"]);
  if (!adminAllowed()) return Response.json({ error: "admin is not licensed on this install" }, { status: 403 });
  const { runId, approved } = await json(request, Body);
  const run = await engine().signal(runId, "decision", { approved });
  return Response.json({ runId: run.id, status: run.status, output: run.output });
});
