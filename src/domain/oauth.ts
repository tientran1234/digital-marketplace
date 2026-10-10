/**
 * The rules a sign-in through an identity provider obeys, with no network, no
 * database and no clock of their own. The flow leaves this application for a
 * provider and comes back as a GET that anyone can aim at us, so the three
 * things that bound it — how long a started flow stays finishable, that the
 * browser coming back is the one that left, and what the provider has to have
 * proved about an address before it is allowed to be an account here — are
 * decided here and read by `server/oauth.ts`.
 */

/** Long enough to sign in at the provider and pick an account, short enough that a tab left open overnight is not a spare flow. */
export const FLOW_TTL_MS = 10 * 60_000;

/** What the start of a flow has to remember until the callback arrives. */
export type Flow = {
  /** Echoed back by the provider in the query, where it is compared against this copy. */
  state: string;
  /** The PKCE secret. Only its hash went to the provider, so this is what proves the exchange is ours. */
  verifier: string;
  /** Where the callback lands — read from the flow rather than the request, so a crafted callback cannot aim it. */
  locale: string;
  expiresAt: number;
};

export type FlowStatus = "valid" | "expired";

export function flowStatus(flow: { expiresAt: number }, now: Date): FlowStatus {
  return flow.expiresAt <= now.getTime() ? "expired" : "valid";
}

/**
 * Nothing matches an empty state. A flow cookie that decoded to no state and
 * a callback that carries none would otherwise compare equal, which is the one
 * pair of values an attacker can produce without ever starting a flow.
 */
export function stateMatches(expected: string, received: string): boolean {
  return expected.length > 0 && expected === received;
}

/** What a provider tells us about whoever just signed in, in the one shape `server/oauth.ts` reads. */
export type ProviderProfile = {
  /** The provider's own id for the account. Kept for logs; an account here is still keyed by its address. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
};

export type ProfileCheck =
  | { ok: true; email: string; name: string }
  | { ok: false; reason: "no_email" | "unverified" };

/**
 * An account here is keyed by its address, and the sign-in link's rule is that
 * clicking the link is the address proving itself. A provider that hands us an
 * address it has not verified has proved nothing of the kind, so taking one
 * would let anyone who can type an address into a provider account walk into
 * whatever that address already owns here — which is every door this
 * application has, since the two sign-ins land on the same user row.
 *
 * The address is lowercased because the user table's unique index is not case
 * folded: `Buyer@acme.test` from a provider must find the account the link at
 * `buyer@acme.test` made, not start a second one beside it.
 */
export function acceptProfile(profile: ProviderProfile): ProfileCheck {
  const email = profile.email.trim().toLowerCase();
  if (!email) return { ok: false, reason: "no_email" };
  if (!profile.emailVerified) return { ok: false, reason: "unverified" };
  return { ok: true, email, name: displayName(email, profile.name) };
}

/** The same fallback a sign-in link uses, so an account reads the same whichever door opened it. */
export function displayName(email: string, name?: string): string {
  return name?.trim() || email.split("@")[0] || email;
}
