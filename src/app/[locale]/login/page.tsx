import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("login");
  return (<><h1>{t("title")}</h1><LoginForm locale={locale} /></>);
}
