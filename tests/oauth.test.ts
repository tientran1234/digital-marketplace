import { describe, expect, it } from "vitest";
import {
  FLOW_TTL_MS,
  PROVIDER_NAMES,
  acceptProfile,
  displayName,
  flowStatus,
  isProviderName,
  stateMatches,
  type ProviderName,
} from "@/domain/oauth";
import { callbackUrl, completeFlow, pkce, sealFlow, selectOAuthProviders, startFlow, unsealFlow } from "@/server/oauth";
import { googleOAuth } from "@/providers/google";
import { oidcOAuth } from "@/providers/oidc";

const at = (ms: number) => new Date(ms);
const verified = { sub: "goog_1", email: "buyer@acme.test", emailVerified: true, name: "Buyer" };

describe("the rules of a provider sign-in", () => {
  const started = at(1_000_000);
  const expiresAt = started.getTime() + FLOW_TTL_MS;

  it("is finishable until the moment it expires, and not on it", () => {
    expect(flowStatus({ expiresAt }, started)).toBe("valid");
    expect(flowStatus({ expiresAt }, at(expiresAt - 1))).toBe("valid");
    expect(flowStatus({ expiresAt }, at(expiresAt))).toBe("expired");
    expect(flowStatus({ expiresAt }, at(expiresAt + 1))).toBe("expired");
  });

  it("knows the doors it has and nothing else", () => {
    for (const name of PROVIDER_NAMES) expect(isProviderName(name)).toBe(true);
    // What arrives in a query or a cookie: anything at all, and a provider is
    // picked by it.
    for (const junk of ["", "Google", "okta", "__proto__", undefined, null, 1, {}]) {
      expect(isProviderName(junk), String(junk)).toBe(false);
    }
  });

  it("matches a state against itself and nothing against an empty one", () => {
    expect(stateMatches("st_1", "st_1")).toBe(true);
    expect(stateMatches("st_1", "st_2")).toBe(false);
    expect(stateMatches("st_1", "")).toBe(false);
    // The pair an attacker can produce without starting a flow at all.
    expect(stateMatches("", "")).toBe(false);
  });
});

describe("what a provider has to have proved", () => {
  /** The whole point of the check: an unverified address is a way into the account that address already has here. */
  it("refuses an address the provider has not verified", () => {
    expect(acceptProfile({ ...verified, emailVerified: false })).toEqual({ ok: false, reason: "unverified" });
    expect(acceptProfile(verified)).toEqual({ ok: true, email: "buyer@acme.test", name: "Buyer" });
  });

  it("refuses a profile with no address at all", () => {
    expect(acceptProfile({ ...verified, email: "" })).toEqual({ ok: false, reason: "no_email" });
    expect(acceptProfile({ ...verified, email: "   " })).toEqual({ ok: false, reason: "no_email" });
  });

  /** The user table's unique index is not case folded, so capitals would be a second account for one person. */
  it("lowercases the address the account is keyed by", () => {
    const check = acceptProfile({ ...verified, email: " Buyer@Acme.Test " });
    expect(check).toEqual({ ok: true, email: "buyer@acme.test", name: "Buyer" });
  });

  it("names an account after the local part when the provider has no name", () => {
    expect(displayName("buyer@acme.test")).toBe("buyer");
    expect(displayName("buyer@acme.test", "   ")).toBe("buyer");
    expect(displayName("buyer@acme.test", "Buyer")).toBe("Buyer");
  });
});

describe("the google provider", () => {
  const config = { clientId: "cid", clientSecret: "secret", redirectUri: "https://shop.example/api/auth/oauth/callback" };
  const google = (impl: typeof fetch) => googleOAuth(config, impl);

  /** PKCE's whole point: the secret stays here, so a code lifted off the callback is not exchangeable. */
  it("sends the hash of the verifier to the provider and never the verifier", () => {
    const { verifier, challenge } = pkce();
    const url = new URL(googleOAuth(config).authorizeUrl({ state: "st_1", challenge }));
    expect(url.searchParams.get("code_challenge")).toBe(challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain(verifier);
  });

  it("asks for a code, with the state and the scopes an account is made of", () => {
    const url = new URL(googleOAuth(config).authorizeUrl({ state: "st_1", challenge: "ch_1" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("st_1");
  });

  it("exchanges the code with the verifier, then reads the profile with the token", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const profile = await google((async (url, init) => {
      seen.push({ url: String(url), init: init ?? undefined });
      return seen.length === 1
        ? Response.json({ access_token: "at_1" })
        : Response.json({ sub: "goog_1", email: "buyer@acme.test", email_verified: true, name: "Buyer" });
    }) as typeof fetch).profile("code_1", "ver_1");

    expect(seen[0].url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(seen[0].init!.body as string);
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "authorization_code",
      code: "code_1",
      code_verifier: "ver_1",
      client_id: "cid",
      client_secret: "secret",
      redirect_uri: config.redirectUri,
    });

    expect(seen[1].url).toBe("https://openidconnect.googleapis.com/v1/userinfo");
    expect((seen[1].init!.headers as Record<string, string>).authorization).toBe("Bearer at_1");
    expect(profile).toEqual({ sub: "goog_1", email: "buyer@acme.test", emailVerified: true, name: "Buyer" });
  });

  /** A claim that is the string "true", or missing, is an address nobody has proved. */
  it("counts nothing but a literal true as verified", async () => {
    const reading = (claim: unknown) =>
      google((async (url) =>
        String(url).includes("token")
          ? Response.json({ access_token: "at_1" })
          : Response.json({ sub: "s", email: "buyer@acme.test", email_verified: claim })) as typeof fetch).profile("c", "v");

    expect((await reading(true)).emailVerified).toBe(true);
    expect((await reading("true")).emailVerified).toBe(false);
    expect((await reading(undefined)).emailVerified).toBe(false);
  });

  it("throws rather than signing anyone in when the exchange is rejected", async () => {
    const rejected = google((async () => new Response("bad_verification_code", { status: 400 })) as typeof fetch);
    await expect(rejected.profile("c", "v")).rejects.toThrow(/400/);

    const tokenless = google((async () => Response.json({ scope: "openid" })) as typeof fetch);
    await expect(tokenless.profile("c", "v")).rejects.toThrow(/access_token/);
  });
});

describe("an operator's own OpenID provider", () => {
  const config = {
    clientId: "cid",
    clientSecret: "secret",
    redirectUri: "https://shop.example/api/auth/oauth/callback",
    authorizeUrl: "https://login.example.com/authorize?p=b2c_1_signin",
    tokenUrl: "https://login.example.com/token",
    userinfoUrl: "https://login.example.com/userinfo",
  };
  const oidc = (impl: typeof fetch) => oidcOAuth(config, impl);

  it("asks the configured endpoint for a code, with PKCE and the same scopes", () => {
    const url = new URL(oidcOAuth(config).authorizeUrl({ state: "st_1", challenge: "ch_1" }));
    expect(url.origin + url.pathname).toBe("https://login.example.com/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("st_1");
    expect(url.searchParams.get("code_challenge")).toBe("ch_1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  /** A tenant or a policy in the configured URL is part of where the provider's sign-in lives; dropping it sends a buyer to one the provider does not have. */
  it("keeps the query the configured URL already carried", () => {
    const url = new URL(oidcOAuth(config).authorizeUrl({ state: "st_1", challenge: "ch_1" }));
    expect(url.searchParams.get("p")).toBe("b2c_1_signin");
  });

  it("exchanges the code at the configured endpoints, verifier first, token second", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const profile = await oidc((async (url, init) => {
      seen.push({ url: String(url), init: init ?? undefined });
      return seen.length === 1
        ? Response.json({ access_token: "at_1" })
        : Response.json({ sub: "idp_1", email: "buyer@acme.test", email_verified: true, name: "Buyer" });
    }) as typeof fetch).profile("code_1", "ver_1");

    expect(seen[0].url).toBe(config.tokenUrl);
    expect(Object.fromEntries(new URLSearchParams(seen[0].init!.body as string))).toEqual({
      grant_type: "authorization_code",
      code: "code_1",
      code_verifier: "ver_1",
      client_id: "cid",
      client_secret: "secret",
      redirect_uri: config.redirectUri,
    });

    expect(seen[1].url).toBe(config.userinfoUrl);
    expect((seen[1].init!.headers as Record<string, string>).authorization).toBe("Bearer at_1");
    expect(profile).toEqual({ sub: "idp_1", email: "buyer@acme.test", emailVerified: true, name: "Buyer" });
  });

  /** The claim an account here is made of: a provider that will not assert it cannot be a door, and this is where that is decided. */
  it("counts nothing but a literal true as verified", async () => {
    const reading = (claim: unknown) =>
      oidc((async (url) =>
        String(url) === config.tokenUrl
          ? Response.json({ access_token: "at_1" })
          : Response.json({ sub: "s", email: "buyer@acme.test", email_verified: claim })) as typeof fetch).profile("c", "v");

    expect((await reading(true)).emailVerified).toBe(true);
    expect((await reading("true")).emailVerified).toBe(false);
    expect((await reading(undefined)).emailVerified).toBe(false);
  });

  it("throws rather than signing anyone in when the exchange is rejected", async () => {
    const rejected = oidc((async () => new Response("invalid_grant", { status: 400 })) as typeof fetch);
    await expect(rejected.profile("c", "v")).rejects.toThrow(/400/);

    const tokenless = oidc((async () => Response.json({ scope: "openid" })) as typeof fetch);
    await expect(tokenless.profile("c", "v")).rejects.toThrow(/access_token/);
  });
});

describe("choosing the doors", () => {
  const google = { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret" };
  const oidc = {
    OIDC_CLIENT_ID: "cid",
    OIDC_CLIENT_SECRET: "secret",
    OIDC_AUTHORIZE_URL: "https://login.example.com/authorize",
    OIDC_TOKEN_URL: "https://login.example.com/token",
    OIDC_USERINFO_URL: "https://login.example.com/userinfo",
  };
  const APP_URL = "https://shop.example";

  it("is nothing at all when nothing is configured, so there is no button", () => {
    expect(selectOAuthProviders({ APP_URL })).toEqual([]);
  });

  it("offers each door that is configured, and either one on its own", () => {
    expect(selectOAuthProviders({ APP_URL, ...google }).map((d) => d.name)).toEqual(["google"]);
    expect(selectOAuthProviders({ APP_URL, ...oidc }).map((d) => d.name)).toEqual(["oidc"]);
    expect(selectOAuthProviders({ APP_URL, ...google, ...oidc }).map((d) => d.name)).toEqual(["google", "oidc"]);
  });

  /** Falling back here would be a button that takes a buyer to a provider and fails on the way back. */
  it("refuses to fall back when a door is half configured", () => {
    expect(() => selectOAuthProviders({ APP_URL, ...google, GOOGLE_CLIENT_SECRET: undefined })).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(() => selectOAuthProviders({ APP_URL, ...oidc, OIDC_TOKEN_URL: undefined })).toThrow(/OIDC_TOKEN_URL/);
    // Every name that is missing, so one trip through the error is enough to finish the job.
    expect(() => selectOAuthProviders({ APP_URL, ...oidc, OIDC_TOKEN_URL: undefined, OIDC_USERINFO_URL: undefined })).toThrow(
      /OIDC_TOKEN_URL, OIDC_USERINFO_URL/,
    );
  });

  /** A deployment that is not what it was meant to be, rather than a page quietly missing the button just configured. */
  it("lets no door through while another is half configured", () => {
    expect(() => selectOAuthProviders({ APP_URL, ...google, ...oidc, OIDC_CLIENT_SECRET: undefined })).toThrow(/oidc/);
  });

  it("registers one redirect URI for every door, derived from APP_URL", () => {
    expect(callbackUrl(APP_URL)).toBe("https://shop.example/api/auth/oauth/callback");
    const doors = selectOAuthProviders({ APP_URL, ...google, ...oidc });
    for (const door of doors) {
      expect(new URL(door.authorizeUrl({ state: "st_1", challenge: "ch_1" })).searchParams.get("redirect_uri")).toBe(
        callbackUrl(APP_URL),
      );
    }
  });
});

describe("the flow cookie", () => {
  const secret = "secret-at-least-16-bytes";
  const flow = { state: "st_1", verifier: "ver_1", locale: "vi", provider: "google" as const, expiresAt: 2_000_000 };
  const before = at(flow.expiresAt - 1);

  it("comes back as it went in", () => {
    expect(unsealFlow(sealFlow(flow, secret), secret, before)).toEqual(flow);
  });

  /** The signature is what makes the state a value we issued, rather than one whoever wrote the cookie also wrote into the query. */
  it("refuses a cookie it did not sign", () => {
    const sealed = sealFlow(flow, secret);
    const [body, mac] = sealed.split(".");
    expect(unsealFlow(sealed, "another-secret-entirely", before)).toBeNull();
    expect(unsealFlow(`${body}.${mac.slice(0, -1)}x`, secret, before)).toBeNull();
    expect(unsealFlow(body, secret, before)).toBeNull();
    expect(unsealFlow(undefined, secret, before)).toBeNull();

    const forged = Buffer.from(JSON.stringify({ ...flow, state: "st_2" })).toString("base64url");
    expect(unsealFlow(`${forged}.${mac}`, secret, before)).toBeNull();
  });

  /** One callback URL serves every door, so the cookie is the only thing that says which one this code came from. */
  it("names the door the flow left by", () => {
    const provider = { name: "oidc" as const, authorizeUrl: () => "https://idp.test/authorize", profile: async () => verified };
    const started = startFlow(provider, "en", secret, at(1_000_000));
    expect(unsealFlow(started.cookie.value, secret, at(1_000_000))?.provider).toBe("oidc");
  });

  /** Sealed with our own secret and still refused: a cookie from before there was a second door names no door at all. */
  it("refuses one of its own that names a door this application does not have", () => {
    for (const named of [{ ...flow, provider: "okta" }, { ...flow, provider: undefined }]) {
      expect(unsealFlow(sealFlow(named as never, secret), secret, before), String(named.provider)).toBeNull();
    }
  });

  it("refuses one of its own once the flow has run out", () => {
    const sealed = sealFlow(flow, secret);
    expect(unsealFlow(sealed, secret, at(flow.expiresAt))).toBeNull();
    expect(unsealFlow(sealed, secret, at(flow.expiresAt + 1))).toBeNull();
  });

  it("is sent on the redirect back from the provider, which strict would drop", () => {
    const provider = { name: "google" as const, authorizeUrl: ({ state }: { state: string }) => `https://provider.test/?state=${state}`, profile: async () => verified };
    const started = startFlow(provider, "vi", secret, at(1_000_000));

    expect(started.cookie.options.sameSite).toBe("lax");
    expect(started.cookie.options.httpOnly).toBe(true);
    expect(started.cookie.options.expires.getTime()).toBe(1_000_000 + FLOW_TTL_MS);
    // The state in the URL is the one sealed in the cookie, and the verifier is in neither.
    const sealedFlow = unsealFlow(started.cookie.value, secret, at(1_000_000))!;
    expect(new URL(started.url).searchParams.get("state")).toBe(sealedFlow.state);
    expect(started.url).not.toContain(sealedFlow.verifier);
  });
});

describe("finishing a flow", () => {
  const secret = "secret-at-least-16-bytes";
  const now = at(1_000_000);
  const flow = { state: "st_1", verifier: "ver_1", locale: "vi", provider: "google" as const, expiresAt: now.getTime() + FLOW_TTL_MS };
  const sealed = sealFlow(flow, secret);

  /** A provider that is called is a code that is spent; these refusals have to come first. */
  const spying = (profile = verified, name: ProviderName = "google") => {
    let calls = 0;
    return {
      calls: () => calls,
      /** As the routes pass it: the door is reached by the name on the cookie, never carried in from the start. */
      lookup: (asked: ProviderName) =>
        asked === name
          ? {
              name,
              authorizeUrl: () => "https://provider.test/",
              profile: async () => {
                calls += 1;
                return profile;
              },
            }
          : null,
    };
  };

  it("spends nothing on a callback it cannot tie to a flow of its own", async () => {
    for (const [callback, cookie] of [
      [{ code: "c", state: "st_2" }, sealed],
      [{ code: "c", state: "" }, sealed],
      [{ code: "", state: "st_1" }, sealed],
      [{ code: "c", state: "st_1" }, undefined],
      [{ code: "c", state: "st_1" }, sealFlow(flow, "another-secret-entirely")],
    ] as const) {
      const spy = spying();
      expect(await completeFlow(spy.lookup, callback, cookie, secret, now)).toEqual({ ok: false, reason: "state", provider: null });
      expect(spy.calls()).toBe(0);
    }
  });

  /** One callback URL for every door, so the cookie is what says whose code this is. */
  it("finishes at the door the flow left by, and reaches for no other", async () => {
    const google = spying(verified, "google");
    // Unverified, so the one that answers is the one named and no account is written: which door was reached is what this is about.
    const oidc = spying({ ...verified, sub: "idp_1", emailVerified: false }, "oidc");
    const lookup = (asked: ProviderName) => google.lookup(asked) ?? oidc.lookup(asked);

    const left = sealFlow({ ...flow, provider: "oidc" }, secret);
    expect(await completeFlow(lookup, { code: "c", state: "st_1" }, left, secret, now)).toEqual({
      ok: false,
      reason: "unverified",
      provider: "oidc",
    });
    expect(oidc.calls()).toBe(1);
    expect(google.calls()).toBe(0);
  });

  /** A door taken out of the environment between the two halves of a flow: a code we cannot exchange is spent on nobody. */
  it("spends nothing for a flow whose door is no longer configured", async () => {
    const spy = spying(verified, "google");
    const left = sealFlow({ ...flow, provider: "oidc" }, secret);
    expect(await completeFlow(spy.lookup, { code: "c", state: "st_1" }, left, secret, now)).toEqual({
      ok: false,
      reason: "state",
      provider: "oidc",
    });
    expect(spy.calls()).toBe(0);
  });

  it("reads a cancelled sign-in as cancelled, without reaching for the provider", async () => {
    const spy = spying();
    const denied = await completeFlow(spy.lookup, { code: "", state: "", error: "access_denied" }, sealed, secret, now);
    expect(denied).toEqual({ ok: false, reason: "denied", provider: null });
    expect(spy.calls()).toBe(0);
  });

  /** The address check standing between a provider's say-so and an account on this marketplace. */
  it("creates no account for an address the provider has not verified", async () => {
    const spy = spying({ ...verified, emailVerified: false });
    const result = await completeFlow(spy.lookup, { code: "c", state: "st_1" }, sealed, secret, now);
    // Named, because the message the sign-in page shows for this says which provider has not verified what.
    expect(result).toEqual({ ok: false, reason: "unverified", provider: "google" });
    expect(spy.calls()).toBe(1);
  });

  it("creates no account for a provider account with no address", async () => {
    const spy = spying({ ...verified, email: "" });
    expect(await completeFlow(spy.lookup, { code: "c", state: "st_1" }, sealed, secret, now)).toEqual({
      ok: false,
      reason: "no_email",
      provider: "google",
    });
  });
});
