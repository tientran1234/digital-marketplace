import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { PLANS } from "@/domain/plans";
import { getCurrentUser } from "@/server/auth";
import { entitlementsForUser } from "@/server/billing";
import { RefundButton } from "@/components/RefundButton";
import { UpgradeButton } from "@/components/UpgradeButton";

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  const t = await getTranslations("account");
  const [ent, orders] = await Promise.all([
    entitlementsForUser(user.id),
    db.order.findMany({ where: { buyerId: user.id }, orderBy: { createdAt: "desc" }, include: { product: { select: { title: true, slug: true } } } }),
  ]);
  return (
    <>
      <h1>{t("title")}</h1>
      <p className="sub">{user.email} · {user.role}</p>
      <h2>{t("plan")}</h2>
      <div className="row">
        <span className="tag ok">{PLANS[ent.planKey].name}</span>
        <span className="muted">{ent.quotas.aiMessages} AI msgs / month</span>
        {ent.planKey === "free" && <UpgradeButton label={t("upgrade", { price: money(PLANS.pro.priceMinor, "usd", locale) ?? "" })} />}
      </div>
      <h2>{t("orders")}</h2>
      {orders.length === 0 ? <p className="muted">{t("noOrders")}</p> : (
        <table><thead><tr><th>Product</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td><Link href={`/${locale}/p/${o.product.slug}`}>{o.product.title}</Link></td>
              <td>{money(o.amountMinor, o.currency, locale)}</td>
              <td><span className={`tag ${o.status === "PAID" ? "ok" : o.status === "PENDING" ? "warn" : ""}`}>{o.status}</span></td>
              <td>{o.status === "PAID" && <RefundButton orderId={o.id} />}</td>
            </tr>
          ))}
        </tbody></table>
      )}
    </>
  );
}
