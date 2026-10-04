import { z } from "zod";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { adminAllowed } from "@/server/license";
import { moderateReview } from "@/server/reviews";

export const runtime = "nodejs";
const Body = z.object({ reviewId: z.string().min(1), approved: z.boolean() });

/**
 * A buyer's rating, published or rejected. Not ./review, which is the listing
 * going live — that one signals a durable run, this one is a row changing state.
 */
export const POST = handle(async (request) => {
  await requireUser(["ADMIN"]);
  if (!adminAllowed()) return Response.json({ error: "admin is not licensed on this install" }, { status: 403 });
  const { reviewId, approved } = await json(request, Body);
  const decided = await moderateReview(reviewId, approved);
  if (!decided) return Response.json({ error: "already decided" }, { status: 409 });
  return Response.json({ reviewId, status: approved ? "PUBLISHED" : "REJECTED" });
});
