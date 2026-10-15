"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ProviderName } from "@/domain/oauth";
import { post } from "./client";

export function LoginForm({
  locale,
  linkFailed,
  oauthFailure,
  failedWith,
  doors,
}: {
  locale: string;
  linkFailed: boolean;
  oauthFailure: "failed" | "unverified" | null;
  /** Which provider the failure was with, for the one message that names it. */
  failedWith: ProviderName | null;
  /** The doors configured, in the order they are offered. Empty is an emailed link and nothing else, which is the dev default. */
  doors: ProviderName[];
}) {
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (sent) return (<><h2>{t("sent")}</h2><p className="muted">{t("sentHint", { email: sent })}</p></>);

  return (
    <>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await post("/api/auth/request-link", { email, locale });
            setSent(email);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label>{t("email")}</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        {/* One message for used, expired and unrecognised alike: all three call for the same next step, and telling them apart says which links exist. */}
        {linkFailed && <p className="err">{t("linkError")}</p>}
        {oauthFailure && (
          <p className="err">
            {oauthFailure === "unverified" && failedWith
              ? t("oauthUnverified", { provider: t(`providers.${failedWith}`) })
              : t("oauthError")}
          </p>
        )}
        {error && <p className="err">{error}</p>}
        <button type="submit">{t("submit")}</button>
      </form>
      {/* A link and not a fetch: the flow has to be entered by a navigation the
          browser keeps the cookie of, and what it goes to is a redirect. The
          name in it is what the start route picks the provider by. */}
      {doors.length > 0 && (
        <p className="row">
          <span className="muted">{t("or")}</span>
          {doors.map((door) => (
            <a key={door} className="btn ghost" href={`/api/auth/oauth/start?provider=${door}&locale=${locale}`}>
              {t("continue", { provider: t(`providers.${door}`) })}
            </a>
          ))}
        </p>
      )}
    </>
  );
}
