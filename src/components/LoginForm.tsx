"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { post } from "./client";

export function LoginForm({ locale }: { locale: string }) {
  const t = useTranslations("login");
  const router = useRouter();
  const [email, setEmail] = useState("buyer@example.test");
  const [role, setRole] = useState("BUYER");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await post("/api/auth/dev-login", { email, role });
          router.push(`/${locale}`);
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <label>{t("email")}</label>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <label>{t("role")}</label>
      <select value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="BUYER">Buyer</option><option value="SELLER">Seller</option><option value="ADMIN">Admin</option>
      </select>
      <p className="muted">{t("devNote")}</p>
      {error && <p className="err">{error}</p>}
      <button type="submit">{t("submit")}</button>
    </form>
  );
}
