import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { downloadAccess } from "@/domain/access";
import { getCurrentUser } from "@/server/auth";
import { entitlementsForUser } from "@/server/billing";
import { currentPeriod } from "@/server/usage";
import { AskBox } from "@/components/AskBox";
import { BuyButton } from "@/components/BuyButton";

export default async function ProductPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const t = await getTranslations("product");
  const [product, user] = await Promise.all([
    db.product.findUnique({ where: { slug }, include: { seller: { select: { name: true } } } }),
    getCurrentUser(),
  ]);
  if (!product) notFound();

  const orders = user ? await db.order.findMany({ where: { buyerId: user.id, productId: product.id }, select: { status: true } }) : [];
  const access = downloadAccess({ userId: user?.id ?? null, role: user?.role ?? null, product, orderStatuses: orders.map((o) => o.status) });
  const visible = product.status === "PUBLISHED" || access.allowed;
  if (!visible) return <p className="muted">{t("unpublished")}</p>;

  const price = money(product.priceMinor, product.currency, locale);
  let quota: { used: number; limit: number } | null = null;
  if (user) {
    const ent = await entitlementsForUser(user.id);
    const row = await db.usageCounter.findUnique({ where: { userId_feature_period: { userId: user.id, feature: "aiMessages", period: currentPeriod() } } });
    quota = { used: row?.used ?? 0, limit: ent.quotas.aiMessages };
  }

  return (
    <>
      <h1>{product.title}</h1>
      <p className="sub">{t("by", { seller: product.seller.name })} · {price ?? "Free"}</p>
      <p>{product.description}</p>
      <div className="row" style={{ margin: "20px 0" }}>
        {access.allowed ? (
          <>
            <a className="btn" href={`/api/products/${product.id}/download`}>{t("download")}</a>
            {access.reason === "purchased" && <span className="tag ok">{t("owned")}</span>}
          </>
        ) : user && price ? (
          <BuyButton productId={product.id} label={t("buy", { price })} />
        ) : (
          <a className="btn" href={`/${locale}/login`}>{t("signInToAsk")}</a>
        )}
      </div>
      {user ? (
        <>
          <AskBox productId={product.id} />
          {quota && <p className="muted">{t("quota", quota)}</p>}
        </>
      ) : (
        <p className="muted">{t("signInToAsk")}</p>
      )}
    </>
  );
}
