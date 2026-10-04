import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { cover } from "@/lib/cover";
import { money } from "@/lib/format";
import { productRatings } from "@/server/reviews";
import { NO_RATINGS } from "@/domain/review";
import { EmptyState } from "@/components/EmptyState";
import { Rating } from "@/components/Rating";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const [t, tReviews] = await Promise.all([getTranslations("home"), getTranslations("reviews")]);
  const products = await db.product.findMany({ where: { status: "PUBLISHED" }, orderBy: { createdAt: "desc" }, include: { seller: { select: { name: true } } } });
  // One grouped query for the whole grid rather than one per card.
  const ratings = await productRatings(products.map((p) => p.id));
  return (
    <>
      <h1>{t("title")}</h1>
      <p className="sub">{t("subtitle")}</p>
      {products.length === 0 ? <EmptyState title={t("empty")} hint={t("emptyHint")} /> : (
        <div className="grid">
          {products.map((p) => {
            const art = cover(p);
            const rated = ratings.get(p.id) ?? NO_RATINGS;
            return (
              <Link key={p.id} href={`/${locale}/p/${p.slug}`} className="card">
                {/* The gradient is data, not decoration the stylesheet can know: it comes from the slug. */}
                <div className="cover" style={{ background: `linear-gradient(135deg, ${art.from}, ${art.to})` }} aria-hidden>{art.initials}</div>
                <div className="body">
                  <h3>{p.title}</h3>
                  <p>{p.description}</p>
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
