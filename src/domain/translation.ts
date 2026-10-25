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
  ].join(" ");
}

/**
 * The listing as the model receives it: the same shape it has to answer in, so
 * a description that happens to contain "Title:" is still a description.
 */
export function draftInput(source: ListingText): string {
  return JSON.stringify({ title: source.title, description: source.description }, null, 2);
}
