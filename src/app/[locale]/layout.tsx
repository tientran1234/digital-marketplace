import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { isLocale, locales } from "@/i18n";
import { getCurrentUser } from "@/server/auth";
import { LogoutButton } from "@/components/LogoutButton";
import "./globals.css";

export const metadata = { title: "Digital marketplace", description: "Digital products, each with an assistant that has read them." };

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const [messages, t, user] = await Promise.all([getMessages(), getTranslations("nav"), getCurrentUser()]);
  const other = locales.find((l) => l !== locale) ?? locale;

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <header className="nav">
            <Link className="brand" href={`/${locale}`}>{t("market")}</Link>
            {user && (user.role === "SELLER" || user.role === "ADMIN") && <Link href={`/${locale}/sell`}>{t("sell")}</Link>}
            {user && <Link href={`/${locale}/account`}>{t("account")}</Link>}
            {user?.role === "ADMIN" && <Link href={`/${locale}/admin`}>{t("admin")}</Link>}
            <Link href={`/${other}`}>{other.toUpperCase()}</Link>
            {user ? <><span className="muted">{user.name}</span><LogoutButton /></> : <Link href={`/${locale}/login`}>{t("login")}</Link>}
          </header>
          <main>{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
