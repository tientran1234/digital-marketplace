import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { cover } from "@/lib/cover";
import { money } from "@/lib/format";
import { localiseListing } from "@/domain/listing";
import { productRatings } from "@/server/reviews";
import { searchProducts } from "@/server/search";
import { NO_RATINGS } from "@/domain/review";
import { EmptyState } from "@/components/EmptyState";
import { Rating } from "@/components/Rating";

const withSeller = { seller: { select: { name: true } }, translations: true };

export default async function Home({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string }> }) {
  const [{ locale }, { q }] = await Promise.all([params, searchParams]);
  const query = (q ?? "").trim();
  const [t, tReviews] = await Promise.all([getTranslations("home"), getTranslations("reviews")]);
  const { products, matched, nearestOnly } = query ? await search(query, locale) : await published();
  // One grouped query for the whole grid rather than one per card.
  const ratings = await productRatings(products.map((p) => p.id));
  return (
    <>
      <h1>{t("title")}</h1>
      <p className="sub">{t("subtitle")}</p>
      <form className="search" role="search" action={`/${locale}`}>
        <input name="q" type="search" defaultValue={query} aria-label={t("searchLabel")} placeholder={t("searchPlaceholder")} />
        <button type="submit">{t("searchAction")}</button>
      </form>
      {nearestOnly ? <p className="sub">{t("nearestOnly")}</p> : null}
      {products.length === 0 ? <EmptyState title={query ? t("noResults", { query }) : t("empty")} hint={query ? t("noResultsHint") : t("emptyHint")} /> : (
        <div className="grid">
          {products.map((p) => {
            // The card is read in the buyer's language where the seller wrote
            // it, and the cover's initials come off the title they can read.
            const text = localiseListing(p, locale);
            const art = cover({ slug: p.slug, title: text.title });
            const rated = ratings.get(p.id) ?? NO_RATINGS;
            const passage = matched.get(p.id);
            return (
              <Link key={p.id} href={`/${locale}/p/${p.slug}`} className="card">
                {/* The gradient is data, not decoration the stylesheet can know: it comes from the slug. */}
                <div className="cover" style={{ background: `linear-gradient(135deg, ${art.from}, ${art.to})` }} aria-hidden>{art.initials}</div>
                <div className="body">
                  <h3>{text.title}</h3>
                  <p>{text.description}</p>
                  {/* Why this listing is in the results when its description does not say so. */}
                  {passage ? <p className="match">{t("foundIn", { passage })}</p> : null}
                  <div className="price">
                    {money(p.priceMinor, p.currency, locale) ?? t("free")}
                    <Rating summary={rated} locale={locale} label={tReviews("rated", { average: rated.average ?? 0, count: rated.count })} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

async function published() {
  const products = await db.product.findMany({ where: { status: "PUBLISHED" }, orderBy: { createdAt: "desc" }, include: withSeller });
  return { products, matched: new Map<string, string>(), nearestOnly: false };
}

/** Hybrid search, kept in the order it ranked them, with the passage each listing matched on. */
async function search(query: string, locale: string) {
  // The reader's locale goes in so the lexical arm matches the words on the
  // card below rather than whichever language the seller happened to write in.
  const hits = await searchProducts(query, { locale });
  const found = await db.product.findMany({ where: { id: { in: hits.map((h) => h.productId) } }, include: withSeller });
  const byId = new Map(found.map((p) => [p.id, p]));
  return {
    products: hits.flatMap((h) => byId.get(h.productId) ?? []),
    matched: new Map(hits.flatMap((h) => (h.heading ? [[h.productId, h.heading] as const] : []))),
    // Nothing the buyer typed is in any document: these came back from the
    // vector arm, which has no threshold to refuse with, so say so rather
    // than let a listing that shares no word with the query look like a match.
    nearestOnly: hits.length > 0 && hits.every((h) => h.ranks.text === null),
  };
}
