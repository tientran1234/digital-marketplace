import { z } from "zod";
import { requireUser } from "@/server/auth";
import { handle, json, type Params } from "@/server/http";
import { RATING_MAX, RATING_MIN } from "@/domain/review";
import { submitReview } from "@/server/reviews";

export const runtime = "nodejs";

// The bounds come from the domain, so widening the scale is one edit rather
// than a route that accepts a 6 the average cannot represent.
const Body = z.object({ rating: z.number().int().min(RATING_MIN).max(RATING_MAX), body: z.string().max(2000).optional() });

/** The buyer rates a purchase. It waits in the moderation queue, not on the page. */
export const POST = handle<Params<"id">>(async (request, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  const { rating, body } = await json(request, Body);
  const outcome = await submitReview({ orderId: id, userId: user.id, rating, body });
  if (!outcome.submitted) return Response.json({ error: outcome.reason }, { status: outcome.reason === "already_reviewed" ? 409 : 403 });
  return Response.json({ reviewId: outcome.reviewId, status: "PENDING" }, { status: 201 });
});
