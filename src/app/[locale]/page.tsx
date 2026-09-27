import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { cover } from "@/lib/cover";
import { money } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("home");
  const products = await db.product.findMany({ where: { status: "PUBLISHED" }, orderBy: { createdAt: "desc" }, include: { seller: { select: { name: true } } } });
  return (
    <>
      <h1>{t("title")}</h1>
      <p className="sub">{t("subtitle")}</p>
      {products.length === 0 ? <EmptyState title={t("empty")} hint={t("emptyHint")} /> : (
        <div className="grid">
          {products.map((p) => {
            const art = cover(p);
            return (
              <Link key={p.id} href={`/${locale}/p/${p.slug}`} className="card">
                {/* The gradient is data, not decoration the stylesheet can know: it comes from the slug. */}
                <div className="cover" style={{ background: `linear-gradient(135deg, ${art.from}, ${art.to})` }} aria-hidden>{art.initials}</div>
                <div className="body">
                  <h3>{p.title}</h3>
                  <p>{p.description}</p>
                  <div className="price">{money(p.priceMinor, p.currency, locale) ?? t("free")}</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
