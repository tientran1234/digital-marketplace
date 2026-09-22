"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { post } from "./client";

export function LogoutButton() {
  const router = useRouter();
  const t = useTranslations("nav");
  return (
    <button className="ghost" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.refresh(); }}>
      {t("logout")}
    </button>
  );
}
void post;
