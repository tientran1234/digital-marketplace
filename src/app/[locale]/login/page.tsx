import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/LoginForm";
import { isProviderName } from "@/domain/oauth";
import { oauthProviders } from "@/server/oauth";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; provider?: string }>;
}) {
  const { locale } = await params;
  // Read here rather than with `useSearchParams` in the form, which would need
  // a Suspense boundary to keep the page prerenderable.
  const { error, provider } = await searchParams;
  // Checked against the doors that exist, like every other provider name that
  // arrives from outside. What it decides is which name a message prints, so
  // an unrecognised one leaves the general message rather than a blank.
  const failedWith = isProviderName(provider) ? provider : null;
  const t = await getTranslations("login");
  return (
    <>
      <h1>{t("title")}</h1>
      <LoginForm
        locale={locale}
        // Still anything unrecognised, so a reason nobody has thought of yet
        // reads as a link to ask for again rather than as nothing at all.
        linkFailed={Boolean(error) && !error!.startsWith("oauth")}
        oauthFailure={error === "oauth_unverified" && failedWith ? "unverified" : error?.startsWith("oauth") ? "failed" : null}
        failedWith={failedWith}
        doors={oauthProviders().map((door) => door.name)}
      />
    </>
  );
}
