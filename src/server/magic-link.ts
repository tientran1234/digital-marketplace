import { createHash, randomBytes } from "node:crypto";
import type { User } from "@prisma/client";
import { LINK_TTL_MS, linkStatus, requestWindowStart, withinRequestLimit } from "@/domain/magic-link";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { mailer } from "@/server/mail";
import { defaultLocale, type Locale } from "@/i18n";
import en from "@/i18n/messages/en.json";
import vi from "@/i18n/messages/vi.json";

const MAIL: Record<Locale, { subject: string; body: string }> = { en: en.login.mail, vi: vi.login.mail };

/** The link is the secret; the row is a fingerprint of it. Looked up by the full hash, so there is nothing to compare byte by byte. */
export function hashLoginToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function signInUrl(appUrl: string, token: string): string {
  const url = new URL("/api/auth/callback", appUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function signInEmail(locale: Locale, link: string): { subject: string; text: string } {
  const copy = MAIL[locale] ?? MAIL[defaultLocale];
  return { subject: copy.subject, text: copy.body.replace("{link}", link) };
}

/**
 * Always returns the same nothing, whether the address has an account, has
 * asked five times already, or has never been seen. The response is the only
 * thing the caller can observe, so anything it varies on is an oracle for
 * who is a customer here.
 */
export async function requestSignInLink(email: string, locale: Locale, now = new Date()): Promise<void> {
  const recent = await db.loginToken.count({ where: { email, createdAt: { gte: requestWindowStart(now) } } });
  if (!withinRequestLimit(recent)) return;

  const token = randomBytes(32).toString("base64url");
  await db.loginToken.create({
    data: { tokenHash: hashLoginToken(token), email, locale, expiresAt: new Date(now.getTime() + LINK_TTL_MS) },
  });
  await mailer().send({ to: email, ...signInEmail(locale, signInUrl(env().APP_URL, token)) });
}

export type Redemption =
  | { ok: true; user: User; locale: Locale }
  | { ok: false; reason: "unknown" | "consumed" | "expired" };

/**
 * The account is created here rather than when the link was asked for: until
 * the link comes back, all we know is that someone typed an address, and
 * creating a row then lets a stranger fill the user table with addresses they
 * do not control. Clicking the link is the address proving itself.
 */
export async function redeemSignInLink(token: string, now = new Date()): Promise<Redemption> {
  if (!token) return { ok: false, reason: "unknown" };
  const link = await db.loginToken.findUnique({ where: { tokenHash: hashLoginToken(token) } });
  if (!link) return { ok: false, reason: "unknown" };

  const status = linkStatus(link, now);
  if (status !== "valid") return { ok: false, reason: status };

  // The update is the lock, the same way the webhook table's insert is: two
  // clicks that both read "valid" leave exactly one of them holding the link.
  const claimed = await db.loginToken.updateMany({ where: { id: link.id, consumedAt: null }, data: { consumedAt: now } });
  if (claimed.count === 0) return { ok: false, reason: "consumed" };

  const user = await db.user.upsert({
    where: { email: link.email },
    create: { email: link.email, name: link.email.split("@")[0] ?? link.email },
    update: {},
  });
  // A link cannot grant a role — the role is whatever the account already has,
  // and a new one is a BUYER by the schema's default.
  return { ok: true, user, locale: (link.locale as Locale) ?? defaultLocale };
}
