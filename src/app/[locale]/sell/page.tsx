import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { NewProductForm } from "@/components/NewProductForm";

const tone: Record<string, string> = { PUBLISHED: "ok", PENDING_REVIEW: "warn", REJECTED: "bad", DRAFT: "" };

export default async function SellPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  if (user.role === "BUYER") redirect(`/${locale}/account`);
  const t = await getTranslations("sell");
  const products = await db.product.findMany({ where: { sellerId: user.id }, orderBy: { createdAt: "desc" } });
  return (
    <>
      <h1>{t("title")}</h1>
      <table><thead><tr><th>Title</th><th>Price</th><th>Status</th></tr></thead><tbody>
        {products.map((p) => (
          <tr key={p.id}>
            <td><Link href={`/${locale}/p/${p.slug}`}>{p.title}</Link></td>
            <td>{money(p.priceMinor, p.currency, locale) ?? "Free"}</td>
            <td><span className={`tag ${tone[p.status] ?? ""}`}>{t(`status.${p.status}` as "status.DRAFT")}</span></td>
          </tr>
        ))}
      </tbody></table>
      <h2>{t("new")}</h2>
      <NewProductForm />
    </>
  );
}
