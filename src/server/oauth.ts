import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { User } from "@prisma/client";
import { FLOW_TTL_MS, acceptProfile, flowStatus, stateMatches, type Flow, type ProviderProfile } from "@/domain/oauth";
import { googleOAuth } from "@/providers/google";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { defaultLocale, isLocale, type Locale } from "@/i18n";

export const FLOW_COOKIE = "dm_oauth";

/** One provider today. The seam is here so a second one is a file in `providers/` rather than a change to the two routes. */
export type OAuthProvider = {
  readonly name: "google";
  authorizeUrl(params: { state: string; challenge: string }): string;
  profile(code: string, verifier: string): Promise<ProviderProfile>;
};

/** The settings that decide whether the button exists, kept narrow so the choice can be exercised without a whole environment. */
export type OAuthEnv = { APP_URL: string } & Partial<Record<"GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET", string>>;

/** Registered with the provider, so it is derived from `APP_URL` rather than read off the request that wants it. */
export function callbackUrl(appUrl: string): string {
  return new URL("/api/auth/oauth/callback", appUrl).toString();
}

/**
 * Nothing configured means no button, which is the dev default: an emailed
 * link signs in with no provider account at all. Half-configured is an error
 * rather than a quiet no, for the same reason half-configured mail is — the
 * fallback there looks like a sign-in page whose links reach a log, and here
 * it looks like a button that takes a buyer to Google and fails on the way
 * back, where the only thing to read is a redirect to `/login`.
 */
export function selectOAuthProvider(e: OAuthEnv): OAuthProvider | null {
  const required = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;
  const missing = required.filter((name) => !e[name]);
  if (missing.length === required.length) return null;
  if (missing.length) throw new Error(`google sign-in is half-configured: ${missing.join(", ")} missing`);
  return {
    name: "google",
    ...googleOAuth({ clientId: e.GOOGLE_CLIENT_ID!, clientSecret: e.GOOGLE_CLIENT_SECRET!, redirectUri: callbackUrl(e.APP_URL) }),
  };
}

let override: OAuthProvider | null = null;
let cached: { provider: OAuthProvider | null } | null = null;

/** Tests inject a provider here. */
export function setOAuthProviderForTests(p: OAuthProvider | null) {
  override = p;
  cached = null;
}

export function oauthProvider(): OAuthProvider | null {
  if (override) return override;
  if (!cached) cached = { provider: selectOAuthProvider(env()) };
  return cached.provider;
}

/** PKCE: the provider is handed the hash and the secret stays in the flow cookie, so a `code` lifted off the callback URL cannot be exchanged by whoever lifted it. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/**
 * The flow waits in the browser rather than a table, because what it has to
 * prove is that the request coming back is from the browser that left, which
 * is what a cookie is and a row is not.
 *
 * It is signed so the state the callback compares against is one this
 * application issued: an unsigned cookie can be planted by anything able to
 * write a cookie on this domain, and a planted state matches a planted query
 * string, which is the check switched off. `SESSION_SECRET` signs it, so
 * rotating that secret ends the flows in the air along with the sessions.
 */
export function sealFlow(flow: Flow, secret: string): string {
  const body = Buffer.from(JSON.stringify(flow)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function unsealFlow(value: string | undefined, secret: string, now = new Date()): Flow | null {
  const [body, mac, ...rest] = (value ?? "").split(".");
  if (!body || !mac || rest.length || !signatureMatches(body, mac, secret)) return null;

  let flow: Flow;
  try {
    flow = JSON.parse(Buffer.from(body, "base64url").toString()) as Flow;
  } catch {
    return null;
  }
  // Signed by us and still checked: a cookie from an older format signs just
  // as well as a current one, and the callback has to be able to say no to it.
  if (typeof flow?.state !== "string" || typeof flow?.verifier !== "string" || typeof flow?.expiresAt !== "number") return null;
  return flowStatus(flow, now) === "valid" ? flow : null;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function signatureMatches(body: string, mac: string, secret: string): boolean {
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export type FlowCookie = {
  name: string;
  value: string;
  options: { httpOnly: true; sameSite: "lax"; secure: boolean; expires: Date; path: string };
};

export type StartedFlow = { url: string; cookie: FlowCookie };

/** The cookie is handed back rather than written here, for the same reason `issueSession`'s is: the one caller is a redirect that has to carry it on the response it redirects with. */
export function startFlow(provider: OAuthProvider, locale: Locale, secret: string, now = new Date()): StartedFlow {
  const state = randomBytes(32).toString("base64url");
  const { verifier, challenge } = pkce();
  const flow: Flow = { state, verifier, locale, expiresAt: now.getTime() + FLOW_TTL_MS };
  return {
    url: provider.authorizeUrl({ state, challenge }),
    cookie: {
      name: FLOW_COOKIE,
      value: sealFlow(flow, secret),
      // `lax` and not `strict`: the callback is a cross-site redirect from the
      // provider, and a strict cookie is not sent on one — the flow would fail
      // every time, with nothing anywhere to say why.
      options: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires: new Date(flow.expiresAt), path: "/" },
    },
  };
}

export type Callback = { code: string; state: string; error?: string };

export type OAuthResult =
  | { ok: true; user: User; locale: Locale }
  | { ok: false; reason: "denied" | "state" | "unverified" | "no_email" };

/**
 * The account is created here rather than when the flow started, the same as a
 * sign-in link's: until the callback comes back all we know is that a browser
 * asked to be sent to Google, and a row written then lets a stranger fill the
 * user table with addresses they do not control.
 *
 * Nothing is exchanged until the state has matched. The code is a credential
 * the provider will spend once, and spending it for a callback we cannot tie
 * to a flow of ours is signing in whoever assembled the URL.
 */
export async function completeFlow(
  provider: OAuthProvider,
  callback: Callback,
  sealed: string | undefined,
  secret: string,
  now = new Date(),
): Promise<OAuthResult> {
  // The provider says `access_denied` when someone presses cancel, which is
  // not a failure to report as one.
  if (callback.error) return { ok: false, reason: "denied" };

  const flow = unsealFlow(sealed, secret, now);
  if (!flow || !stateMatches(flow.state, callback.state) || !callback.code) return { ok: false, reason: "state" };

  const check = acceptProfile(await provider.profile(callback.code, flow.verifier));
  if (!check.ok) return { ok: false, reason: check.reason };

  const user = await db.user.upsert({
    where: { email: check.email },
    create: { email: check.email, name: check.name },
    update: {},
  });
  // A provider cannot grant a role, and cannot rename an account either: the
  // role is whatever the account already has, a new one is a BUYER by the
  // schema's default, and the name a seller trades under is not Google's to
  // overwrite on every sign-in.
  return { ok: true, user, locale: isLocale(flow.locale) ? flow.locale : defaultLocale };
}
