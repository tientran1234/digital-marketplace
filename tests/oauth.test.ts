import { describe, expect, it } from "vitest";
import { FLOW_TTL_MS, acceptProfile, displayName, flowStatus, stateMatches } from "@/domain/oauth";
import { callbackUrl, completeFlow, pkce, sealFlow, selectOAuthProvider, startFlow, unsealFlow } from "@/server/oauth";
import { googleOAuth } from "@/providers/google";

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

describe("choosing a provider", () => {
  const configured = { APP_URL: "https://shop.example", GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret" };

  it("is nothing at all when nothing is configured, so there is no button", () => {
    expect(selectOAuthProvider({ APP_URL: "https://shop.example" })).toBeNull();
    expect(selectOAuthProvider(configured)?.name).toBe("google");
  });

  /** Falling back here would be a button that takes a buyer to Google and fails on the way back. */
  it("refuses to fall back when it is half configured", () => {
    expect(() => selectOAuthProvider({ ...configured, GOOGLE_CLIENT_SECRET: undefined })).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(() => selectOAuthProvider({ ...configured, GOOGLE_CLIENT_ID: undefined })).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it("registers one redirect URI, derived from APP_URL", () => {
    expect(callbackUrl("https://shop.example")).toBe("https://shop.example/api/auth/oauth/callback");
  });
});

describe("the flow cookie", () => {
  const secret = "secret-at-least-16-bytes";
  const flow = { state: "st_1", verifier: "ver_1", locale: "vi", expiresAt: 2_000_000 };
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
  const flow = { state: "st_1", verifier: "ver_1", locale: "vi", expiresAt: now.getTime() + FLOW_TTL_MS };
  const sealed = sealFlow(flow, secret);

  /** A provider that is called is a code that is spent; these refusals have to come first. */
  const spying = (profile = verified) => {
    let calls = 0;
    return {
      calls: () => calls,
      provider: {
        name: "google" as const,
        authorizeUrl: () => "https://provider.test/",
        profile: async () => {
          calls += 1;
          return profile;
        },
      },
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
      expect(await completeFlow(spy.provider, callback, cookie, secret, now)).toEqual({ ok: false, reason: "state" });
      expect(spy.calls()).toBe(0);
    }
  });

  it("reads a cancelled sign-in as cancelled, without reaching for the provider", async () => {
    const spy = spying();
    const denied = await completeFlow(spy.provider, { code: "", state: "", error: "access_denied" }, sealed, secret, now);
    expect(denied).toEqual({ ok: false, reason: "denied" });
    expect(spy.calls()).toBe(0);
  });

  /** The address check standing between a provider's say-so and an account on this marketplace. */
  it("creates no account for an address the provider has not verified", async () => {
    const spy = spying({ ...verified, emailVerified: false });
    const result = await completeFlow(spy.provider, { code: "c", state: "st_1" }, sealed, secret, now);
    expect(result).toEqual({ ok: false, reason: "unverified" });
    expect(spy.calls()).toBe(1);
  });

  it("creates no account for a provider account with no address", async () => {
    const spy = spying({ ...verified, email: "" });
    expect(await completeFlow(spy.provider, { code: "c", state: "st_1" }, sealed, secret, now)).toEqual({ ok: false, reason: "no_email" });
  });
});
