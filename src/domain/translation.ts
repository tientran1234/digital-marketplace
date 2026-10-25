/**
 * What a drafted translation of a listing is allowed to be. A draft is the
 * seller's own words in another language, offered to them in the form they
 * are filling in — so the model is told to carry the listing across and
 * nothing else, and what comes back is held to the bounds the submit route
 * enforces. Pure, so the rules a draft obeys are readable without a key.
 *
 * Nothing here publishes anything: a draft becomes a translation row only
 * when the seller submits the form it landed in, which is why a buyer never
 * reads a sentence no seller stood behind.
 */
import { z } from "zod";
import { language } from "@/lib/format";
import type { ListingText } from "./listing";

/**
 * The same bounds `POST /api/products` holds a submitted translation to. A
 * draft outside them is not a draft: it would fill the form with text the
 * seller cannot submit, and they would have to find out which end of it to
 * cut.
 */
export const DraftedListing = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(2000),
});

/**
 * What the model is asked to do, in the language the prompt is written in
 * rather than either of the listing's: the instructions are ours, and a model
 * told in Vietnamese to write Vietnamese has one more thing to infer.
 *
 * Every rule here is about not becoming the author. A price, a figure or a
 * promise restated is the seller answering for a sentence they never wrote,
 * and a listing that gains a selling point in translation is the marketplace
 * making a claim about someone else's product.
 */
export function draftSystem(from: string, to: string): string {
  return [
    `You translate one marketplace listing from ${language(from)} into ${language(to)}.`,
    "Translate what the listing says and nothing else: add no claim it does not make, and drop none that it does.",
    "Keep every figure, price, version, file format, product name and personal name exactly as it is written.",
    `Write the ${language(to)} a buyer would read on a shop page — not a word-for-word gloss of the ${language(from)}.`,
    "This is a draft the seller will read and correct before it is shown to anyone, so where the source is ambiguous, follow it rather than deciding for them.",
    'Reply with only a JSON object: {"title": "…", "description": "…"}. No prose, no code fence.',
  ].join(" ");
}

/**
 * The listing as the model receives it: the same shape it has to answer in, so
 * a description that happens to contain "Title:" is still a description.
 */
export function draftInput(source: ListingText): string {
  return JSON.stringify({ title: source.title, description: source.description }, null, 2);
}

export type DraftParse = { ok: true; value: z.output<typeof DraftedListing> } | { ok: false; problem: string };

/**
 * The reply as the two fields, or why it is not them. A miss is a value rather
 * than a throw because the caller has somewhere to put it: the seller is
 * waiting on a form field and gets told, which is also why there is no repair
 * round — a second call to find out is a bill against a convenience, and
 * typing the field was always the fallback.
 *
 * A fenced block is taken as the object it wraps. It is the one drift worth
 * being lenient about: every model does it, and a fence around the right two
 * fields is not a model that misunderstood the task.
 */
export function parseDraft(text: string): DraftParse {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  let json: unknown;
  try {
    json = JSON.parse(unfenced);
  } catch {
    return { ok: false, problem: "the model did not answer with JSON" };
  }
  const parsed = DraftedListing.safeParse(json);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, problem: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
}
