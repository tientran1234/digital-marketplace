import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  // Read here rather than with `useSearchParams` in the form, which would need
  // a Suspense boundary to keep the page prerenderable.
  const { error } = await searchParams;
  const t = await getTranslations("login");
  return (<><h1>{t("title")}</h1><LoginForm locale={locale} linkFailed={Boolean(error)} /></>);
}
