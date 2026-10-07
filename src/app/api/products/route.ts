import { z } from "zod";
import { db } from "@/lib/db";
import { defaultLocale, locales } from "@/i18n";
import { writableTranslations } from "@/domain/listing";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";

export const runtime = "nodejs";

/**
 * The seller's words in one other language. Both fields or neither: a
 * translation is shown whole, so half of one is refused here rather than
 * dropped quietly — they typed it, and should be told it will not be shown.
 */
const Translation = z
  .object({ locale: z.enum(locales), title: z.string().trim().max(120), description: z.string().trim().max(2000) })
  .refine((t) => (!t.title && !t.description) || (t.title.length >= 3 && t.description.length >= 10), {
    message: "a translation needs both a title and a description",
  });

const Body = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(2000),
  /** The language the title and description above are written in. */
  locale: z.enum(locales).default(defaultLocale),
  priceMinor: z.number().int().min(0).max(100_000_00),
  translations: z.array(Translation).max(locales.length).optional(),
});

const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Create a DRAFT. Upload a document next, then submit for review. */
export const POST = handle(async (request) => {
  const user = await requireUser(["SELLER", "ADMIN"]);
  const { translations = [], ...listing } = await json(request, Body);
  const base = slugify(listing.title) || "product";
  const slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  const product = await db.product.create({
    data: {
      ...listing,
      slug,
      sellerId: user.id,
      // A language left empty is not a row: the listing falls back to its own
      // text there rather than going blank in it.
      translations: { create: writableTranslations(translations, listing.locale) },
    },
  });
  return Response.json({ id: product.id, slug: product.slug }, { status: 201 });
});
