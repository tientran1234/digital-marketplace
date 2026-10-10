"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { post } from "./client";

export function LoginForm({
  locale,
  linkFailed,
  oauthFailure,
  google,
}: {
  locale: string;
  linkFailed: boolean;
  oauthFailure: "failed" | "unverified" | null;
  google: boolean;
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
        {oauthFailure && <p className="err">{t(oauthFailure === "unverified" ? "oauthUnverified" : "oauthError")}</p>}
        {error && <p className="err">{error}</p>}
        <button type="submit">{t("submit")}</button>
      </form>
      {/* A link and not a fetch: the flow has to be entered by a navigation the
          browser keeps the cookie of, and what it goes to is a redirect. */}
      {google && (
        <p className="row">
          <span className="muted">{t("or")}</span>
          <a className="btn ghost" href={`/api/auth/oauth/start?locale=${locale}`}>{t("google")}</a>
        </p>
      )}
    </>
  );
}
