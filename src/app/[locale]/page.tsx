import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { money } from "@/lib/format";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("home");
  const products = await db.product.findMany({ where: { status: "PUBLISHED" }, orderBy: { createdAt: "desc" }, include: { seller: { select: { name: true } } } });
  return (
    <>
      <h1>{t("title")}</h1>
      <p className="sub">{t("subtitle")}</p>
      {products.length === 0 && <p className="muted">{t("empty")}</p>}
      <div className="grid">
        {products.map((p) => (
          <Link key={p.id} href={`/${locale}/p/${p.slug}`} className="card">
            <h3>{p.title}</h3>
            <p>{p.description}</p>
            <div className="price">{money(p.priceMinor, p.currency, locale) ?? t("free")}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
