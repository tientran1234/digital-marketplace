import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { downloadAccess } from "@/domain/access";
import { getCurrentUser } from "@/server/auth";
import { recordProductView } from "@/server/analytics";
import { threadFor } from "@/server/conversations";
import { entitlementsForUser } from "@/server/billing";
import { currentPeriod } from "@/server/usage";
import { productRating, publishedReviews, reviewEligibilityFor } from "@/server/reviews";
import { AskBox } from "@/components/AskBox";
import { BuyButton } from "@/components/BuyButton";
import { EmptyState } from "@/components/EmptyState";
import { Rating } from "@/components/Rating";
import { ReviewForm } from "@/components/ReviewForm";

export default async function ProductPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const [t, tReviews] = await Promise.all([getTranslations("product"), getTranslations("reviews")]);
  const [product, user] = await Promise.all([
    db.product.findUnique({ where: { slug }, include: { seller: { select: { name: true } } } }),
    getCurrentUser(),
  ]);
  if (!product) notFound();

  const orders = user ? await db.order.findMany({ where: { buyerId: user.id, productId: product.id }, select: { status: true } }) : [];
  const access = downloadAccess({ userId: user?.id ?? null, role: user?.role ?? null, product, orderStatuses: orders.map((o) => o.status) });
  const visible = product.status === "PUBLISHED" || access.allowed;
  if (!visible) return <p className="muted">{t("unpublished")}</p>;

  // Only a published listing has an audience to count, and a counter that
  // fails must never take the page the buyer came for down with it.
  if (product.status === "PUBLISHED") await recordProductView(product, user?.id ?? null).catch(() => {});

  const [rated, reviews, mayReview, thread] = await Promise.all([
    productRating(product.id),
    publishedReviews(product.id),
    reviewEligibilityFor(product.id, user?.id ?? null),
    // Only ever this reader's own thread: a listing has as many as it has askers.
    threadFor(user?.id ?? null, product.id),
  ]);

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
      <p className="sub">
        {t("by", { seller: product.seller.name })} · {price ?? "Free"}
        {rated.average !== null && <> · <Rating summary={rated} locale={locale} label={tReviews("rated", { average: rated.average, count: rated.count })} /></>}
      </p>
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
          <AskBox productId={product.id} history={thread} />
          {quota && <p className="muted">{t("quota", quota)}</p>}
        </>
      ) : (
        <p className="muted">{t("signInToAsk")}</p>
      )}

      <h2>{tReviews("title")}</h2>
      {/* Only a buyer with a purchase that has not spoken yet gets a form, and
          only an admin's decision puts what they write on this page. */}
      {mayReview.allowed ? <ReviewForm orderId={mayReview.orderId} /> : <p className="muted">{tReviews(`refused.${mayReview.reason}` as "refused.anonymous")}</p>}
      {reviews.length === 0 ? <EmptyState title={tReviews("none")} hint={tReviews("noneHint")} /> : (
        <table><tbody>
          {reviews.map((r) => (
            <tr key={r.id}>
              <td>
                <Rating summary={{ count: 1, average: r.rating }} locale={locale} label={tReviews("rated", { average: r.rating, count: 1 })} showCount={false} />
                <div className="muted">{r.buyer.name} · {r.createdAt.toISOString().slice(0, 10)}</div>
              </td>
              <td>{r.body ?? <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody></table>
      )}
    </>
  );
}
