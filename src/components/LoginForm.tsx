"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { post } from "./client";

export function LoginForm({ locale, linkFailed }: { locale: string; linkFailed: boolean }) {
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (sent) return (<><h2>{t("sent")}</h2><p className="muted">{t("sentHint", { email: sent })}</p></>);

  return (
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
      {error && <p className="err">{error}</p>}
      <button type="submit">{t("submit")}</button>
    </form>
  );
}
