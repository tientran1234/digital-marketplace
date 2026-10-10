/** The only file that knows Google's endpoints. Two requests, no SDK — the same trade as `providers/resend.ts`. */
import type { ProviderProfile } from "@/domain/oauth";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function googleOAuth(config: GoogleConfig, fetchImpl: typeof fetch = fetch) {
  return {
    authorizeUrl({ state, challenge }: { state: string; challenge: string }): string {
      const url = new URL(AUTHORIZE);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.redirectUri);
      url.searchParams.set("response_type", "code");
      // `openid email` is what an account here is made of; `profile` is only
      // the display name, which falls back to the address when it is absent.
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },

    async profile(code: string, verifier: string): Promise<ProviderProfile> {
      const token = await fetchImpl(TOKEN, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
        }).toString(),
      });
      if (!token.ok) throw new Error(`google token ${token.status}: ${(await token.text().catch(() => "")).slice(0, 200)}`);
      const { access_token: accessToken } = (await token.json().catch(() => ({}))) as { access_token?: string };
      if (!accessToken) throw new Error("google token response carried no access_token");

      // The token response also carries an `id_token` with these same claims,
      // but reading it means either trusting a JWT we have not checked or
      // verifying a signature to learn what one more request over the same TLS
      // says plainly.
      const info = await fetchImpl(USERINFO, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!info.ok) throw new Error(`google userinfo ${info.status}: ${(await info.text().catch(() => "")).slice(0, 200)}`);
      const raw = (await info.json().catch(() => ({}))) as { sub?: string; email?: string; email_verified?: boolean; name?: string };

      // Verified only on a literal `true`. A missing claim, or the string
      // "true" some providers send, is an address nobody has proved.
      return { sub: raw.sub ?? "", email: raw.email ?? "", emailVerified: raw.email_verified === true, name: raw.name };
    },
  };
}
