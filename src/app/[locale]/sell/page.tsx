import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { analyticsAccess, totals } from "@/domain/analytics";
import { PLANS } from "@/domain/plans";
import { getCurrentUser } from "@/server/auth";
import { sellerAnalytics } from "@/server/analytics";
import { entitlementsForUser } from "@/server/billing";
import { EmptyState } from "@/components/EmptyState";
import { NewProductForm } from "@/components/NewProductForm";
import { UpgradeButton } from "@/components/UpgradeButton";

const tone: Record<string, string> = { PUBLISHED: "ok", PENDING_REVIEW: "warn", REJECTED: "bad", DRAFT: "" };

export default async function SellPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  if (user.role === "BUYER") redirect(`/${locale}/account`);
  const t = await getTranslations("sell");
  const [products, ent] = await Promise.all([
    db.product.findMany({ where: { sellerId: user.id }, orderBy: { createdAt: "desc" } }),
    entitlementsForUser(user.id),
  ]);
  // The gate decides before the query runs: a Free seller is never counted for.
  const stats = analyticsAccess(user.role, ent).allowed ? await sellerAnalytics(user.id) : null;
  const sum = totals(stats ?? []);
  return (
    <>
      <h1>{t("title")}</h1>
      {products.length === 0 ? <EmptyState title={t("noProducts")} hint={t("noProductsHint")} /> : (
        <table><thead><tr><th>Title</th><th>Price</th><th>Status</th></tr></thead><tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td><Link href={`/${locale}/p/${p.slug}`}>{p.title}</Link></td>
              <td>{money(p.priceMinor, p.currency, locale) ?? "Free"}</td>
              <td><span className={`tag ${tone[p.status] ?? ""}`}>{t(`status.${p.status}` as "status.DRAFT")}</span></td>
            </tr>
          ))}
        </tbody></table>
      )}
      {products.length > 0 && (
        <>
          <h2>{t("analytics")}</h2>
          {stats === null ? (
            <div className="row">
              <span className="muted">{t("analyticsPro")}</span>
              <UpgradeButton label={t("upgrade", { price: money(PLANS.pro.priceMinor, "usd", locale) ?? "" })} />
            </div>
          ) : (
            <>
              <p className="muted">{t("analyticsHint")}</p>
              <table><thead><tr><th>Title</th><th>Views</th><th>Purchases</th><th>Questions</th></tr></thead><tbody>
                {stats.map((s) => (
                  <tr key={s.productId}>
                    <td><Link href={`/${locale}/p/${s.slug}`}>{s.title}</Link></td>
                    <td>{s.views}</td><td>{s.purchases}</td><td>{s.questions}</td>
                  </tr>
                ))}
              </tbody><tfoot><tr>
                <td className="muted">{t("total")}</td>
                <td>{sum.views}</td><td>{sum.purchases}</td><td>{sum.questions}</td>
              </tr></tfoot></table>
            </>
          )}
        </>
      )}
      <h2>{t("new")}</h2>
      <NewProductForm />
    </>
  );
}
