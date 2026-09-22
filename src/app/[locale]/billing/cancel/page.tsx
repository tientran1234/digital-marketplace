import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("billing");
  return (<><h1>{t("cancelTitle")}</h1><p className="sub">{t("cancelBody")}</p><Link href={`/${locale}/account`}>{t("back")}</Link></>);
}
