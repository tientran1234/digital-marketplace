import { z } from "zod";
import { locales } from "@/i18n";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { draftTranslation } from "@/server/translate";

export const runtime = "nodejs";

/**
 * The words in the form, not a product id: the listing being drafted for does
 * not exist yet — the sell page creates it when the seller submits — and a
 * draft of a listing that is already published is still only ever the text in
 * front of them.
 */
const Body = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(2000),
  from: z.enum(locales),
  to: z.enum(locales),
}).refine((b) => b.from !== b.to, { message: "a listing is already in its own language" });

/** A draft for the seller's form. It writes nothing: the translation is a row when they submit it. */
export const POST = handle(async (request) => {
  const user = await requireUser(["SELLER", "ADMIN"]);
  const { title, description, from, to } = await json(request, Body);
  const draft = await draftTranslation(user, { source: { title, description }, from, to });
  return Response.json(draft);
});
