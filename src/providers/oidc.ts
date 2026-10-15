/** The only file that knows an OpenID Connect provider's endpoints — read from the environment, because which provider it is belongs to whoever runs this. Two requests, no SDK, the same trade as `providers/google.ts`. */
import type { ProviderProfile } from "@/domain/oauth";

export type OidcConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Set rather than discovered — see the note below on `.well-known`. */
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
};

/**
 * An operator's own provider — Entra, Okta, Auth0, Keycloak, GitLab — behind
 * the same two calls Google is behind, and bound by the same rules.
 *
 * The endpoints are configured and not fetched from
 * `<issuer>/.well-known/openid-configuration`, which is the one thing that
 * would otherwise differ from the file beside this one: discovery is a request
 * whose answer decides where a sign-in goes, and it would have to be made
 * while a buyer waits on the redirect. Three URLs an operator pastes once are
 * three URLs that cannot be wrong at the moment the button is pressed, and the
 * start route stays what it is — a redirect with no network in it.
 *
 * `email_verified` is the claim an account here is made of, so a provider that
 * does not assert it cannot be a door: `domain/oauth.ts` refuses the profile
 * and the sign-in page says so. That is the same fail-closed rule Google is
 * held to, and the one thing to check before configuring these variables.
 */
export function oidcOAuth(config: OidcConfig, fetchImpl: typeof fetch = fetch) {
  return {
    authorizeUrl({ state, challenge }: { state: string; challenge: string }): string {
      const url = new URL(config.authorizeUrl);
      // Added to whatever the configured URL already carries rather than
      // replacing it: an authorize endpoint may come with query of its own —
      // a tenant, a policy, an `acr_values` — and dropping it would send a
      // buyer to a sign-in the provider does not have.
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },

    async profile(code: string, verifier: string): Promise<ProviderProfile> {
      const token = await fetchImpl(config.tokenUrl, {
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
      if (!token.ok) throw new Error(`oidc token ${token.status}: ${(await token.text().catch(() => "")).slice(0, 200)}`);
      const { access_token: accessToken } = (await token.json().catch(() => ({}))) as { access_token?: string };
      if (!accessToken) throw new Error("oidc token response carried no access_token");

      // The userinfo endpoint rather than the `id_token`, for the reason the
      // Google adapter gives: reading the JWT means either trusting claims we
      // have not checked or verifying a signature to learn what one more
      // request over the same TLS says plainly.
      const info = await fetchImpl(config.userinfoUrl, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!info.ok) throw new Error(`oidc userinfo ${info.status}: ${(await info.text().catch(() => "")).slice(0, 200)}`);
      const raw = (await info.json().catch(() => ({}))) as { sub?: string; email?: string; email_verified?: boolean; name?: string };

      // A literal `true` and nothing else, the same as Google's: a claim that
      // is missing, or the string "true" some providers send, is an address
      // nobody here has been told was proved.
      return { sub: raw.sub ?? "", email: raw.email ?? "", emailVerified: raw.email_verified === true, name: raw.name };
    },
  };
}
