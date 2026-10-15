import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { User } from "@prisma/client";
import {
  FLOW_TTL_MS,
  acceptProfile,
  flowStatus,
  isProviderName,
  stateMatches,
  type Flow,
  type ProviderName,
  type ProviderProfile,
} from "@/domain/oauth";
import { googleOAuth } from "@/providers/google";
import { oidcOAuth } from "@/providers/oidc";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { defaultLocale, isLocale, type Locale } from "@/i18n";

export const FLOW_COOKIE = "dm_oauth";

/** A door, named by the one value a flow cookie carries about it. What configures each one is `selectOAuthProvider` below; the two routes know none of them. */
export type OAuthProvider = {
  readonly name: ProviderName;
  authorizeUrl(params: { state: string; challenge: string }): string;
  profile(code: string, verifier: string): Promise<ProviderProfile>;
};

/** The settings that decide which buttons exist, kept narrow so the choice can be exercised without a whole environment. */
export type OAuthEnv = { APP_URL: string } &
  Partial<
    Record<
      | "GOOGLE_CLIENT_ID"
      | "GOOGLE_CLIENT_SECRET"
      | "OIDC_CLIENT_ID"
      | "OIDC_CLIENT_SECRET"
      | "OIDC_AUTHORIZE_URL"
      | "OIDC_TOKEN_URL"
      | "OIDC_USERINFO_URL",
      string
    >
  >;

/** One URL registered with every provider, so it is derived from `APP_URL` rather than read off the request that wants it — and which provider a callback belongs to comes off the flow cookie instead. */
export function callbackUrl(appUrl: string): string {
  return new URL("/api/auth/oauth/callback", appUrl).toString();
}

/**
 * What each door needs set before it exists, in the order the sign-in page
 * offers them. A table rather than a branch per provider, because the rule
 * below is the same rule for all of them and a second copy of it is a second
 * chance to let a half-configured one through.
 */
const DOORS: {
  readonly name: ProviderName;
  readonly required: readonly (keyof OAuthEnv)[];
  readonly build: (e: OAuthEnv, redirectUri: string) => Omit<OAuthProvider, "name">;
}[] = [
  {
    name: "google",
    required: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    build: (e, redirectUri) =>
      googleOAuth({ clientId: e.GOOGLE_CLIENT_ID!, clientSecret: e.GOOGLE_CLIENT_SECRET!, redirectUri }),
  },
  {
    name: "oidc",
    required: ["OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_AUTHORIZE_URL", "OIDC_TOKEN_URL", "OIDC_USERINFO_URL"],
    build: (e, redirectUri) =>
      oidcOAuth({
        clientId: e.OIDC_CLIENT_ID!,
        clientSecret: e.OIDC_CLIENT_SECRET!,
        authorizeUrl: e.OIDC_AUTHORIZE_URL!,
        tokenUrl: e.OIDC_TOKEN_URL!,
        userinfoUrl: e.OIDC_USERINFO_URL!,
        redirectUri,
      }),
  },
];

/**
 * Nothing configured means no button, which is the dev default: an emailed
 * link signs in with no provider account at all. Half-configured is an error
 * rather than a quiet no, for the same reason half-configured mail is — the
 * fallback there looks like a sign-in page whose links reach a log, and here
 * it looks like a button that takes a buyer to a provider and fails on the way
 * back, where the only thing to read is a redirect to `/login`.
 *
 * One door half-configured stops the others too, which is the point: it is a
 * deployment that is not what it was meant to be, and a sign-in page quietly
 * missing the button the operator just configured is the hardest version of
 * this to notice.
 */
export function selectOAuthProviders(e: OAuthEnv): OAuthProvider[] {
  const redirectUri = callbackUrl(e.APP_URL);
  return DOORS.flatMap((door) => {
    const missing = door.required.filter((name) => !e[name]);
    if (missing.length === door.required.length) return [];
    if (missing.length) throw new Error(`${door.name} sign-in is half-configured: ${missing.join(", ")} missing`);
    return [{ name: door.name, ...door.build(e, redirectUri) }];
  });
}

let override: OAuthProvider[] | null = null;
let cached: { providers: OAuthProvider[] } | null = null;

/** Tests inject doors here. `[]` is a marketplace with none, which is not the same as not having chosen yet. */
export function setOAuthProvidersForTests(p: OAuthProvider[] | null) {
  override = p;
  cached = null;
}

export function oauthProviders(): OAuthProvider[] {
  if (override) return override;
  if (!cached) cached = { providers: selectOAuthProviders(env()) };
  return cached.providers;
}

/** The door a name belongs to, or null — which is also the answer for a name that was configured when the flow started and is not now. */
export function oauthProvider(name: ProviderName): OAuthProvider | null {
  return oauthProviders().find((provider) => provider.name === name) ?? null;
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
  // A name no door answers to is refused rather than read as the first door,
  // which includes a cookie sealed before there was more than one: ten minutes
  // of flows end at the deploy that adds a provider, and the buyer holding one
  // presses the button again. Guessing here would be the callback choosing the
  // provider after all.
  if (!isProviderName(flow.provider)) return null;
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
  const flow: Flow = { state, verifier, locale, provider: provider.name, expiresAt: now.getTime() + FLOW_TTL_MS };
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
  /** `provider` is null until the cookie has been opened: before that there is no door to name, and the sign-in page's message for an unverified address names one. */
  | { ok: false; reason: "denied" | "state" | "unverified" | "no_email"; provider: ProviderName | null };

/** How `completeFlow` reaches the door the cookie names. A function, so a test finishes a flow without an environment and the routes pass `oauthProvider`. */
export type ProviderLookup = (name: ProviderName) => OAuthProvider | null;

/**
 * The account is created here rather than when the flow started, the same as a
 * sign-in link's: until the callback comes back all we know is that a browser
 * asked to be sent to a provider, and a row written then lets a stranger fill the
 * user table with addresses they do not control.
 *
 * Nothing is exchanged until the state has matched. The code is a credential
 * the provider will spend once, and spending it for a callback we cannot tie
 * to a flow of ours is signing in whoever assembled the URL.
 */
export async function completeFlow(
  lookup: ProviderLookup,
  callback: Callback,
  sealed: string | undefined,
  secret: string,
  now = new Date(),
): Promise<OAuthResult> {
  // The provider says `access_denied` when someone presses cancel, which is
  // not a failure to report as one.
  if (callback.error) return { ok: false, reason: "denied", provider: null };

  const flow = unsealFlow(sealed, secret, now);
  if (!flow || !stateMatches(flow.state, callback.state) || !callback.code) {
    return { ok: false, reason: "state", provider: null };
  }

  // Which door this is comes off the cookie, and the door itself is looked up
  // now rather than carried from the start: one taken out of the environment
  // between the two halves of a flow is a flow that cannot be finished, and
  // that is the same answer as a callback we cannot tie to a flow — nothing is
  // exchanged either way.
  const provider = lookup(flow.provider);
  if (!provider) return { ok: false, reason: "state", provider: flow.provider };

  const check = acceptProfile(await provider.profile(callback.code, flow.verifier));
  if (!check.ok) return { ok: false, reason: check.reason, provider: provider.name };

  const user = await db.user.upsert({
    where: { email: check.email },
    create: { email: check.email, name: check.name },
    update: {},
  });
  // A provider cannot grant a role, and cannot rename an account either: the
  // role is whatever the account already has, a new one is a BUYER by the
  // schema's default, and the name a seller trades under is not a provider's
  // to overwrite on every sign-in.
  return { ok: true, user, locale: isLocale(flow.locale) ? flow.locale : defaultLocale };
}
