/**
 * The rules a sign-in link obeys, with no database and no clock of their own.
 * A link is a bearer token that arrives by a channel we do not control, so the
 * three things that bound it — how long it lives, that it works once, and how
 * many a mailbox can be sent — are decided here and read by
 * `server/magic-link.ts`.
 */

/** Long enough to walk to the device the mail is on, short enough that a link left in an inbox is not a spare key. */
export const LINK_TTL_MS = 15 * 60_000;

/** A mailbox may ask this often before it has to wait. Per address, not per browser: the browser is what an abuser has plenty of. */
export const MAX_REQUESTS = 5;
export const REQUEST_WINDOW_MS = 15 * 60_000;

export type LinkState = { consumedAt: Date | null; expiresAt: Date };
export type LinkStatus = "valid" | "consumed" | "expired";

/**
 * Consumed is checked before expired so a link reads the same after it times
 * out as it did the moment it was spent. The other order would let a replay
 * come back as "expired", which invites asking for a new link to fix a
 * problem a new link does not fix.
 */
export function linkStatus(link: LinkState, now: Date): LinkStatus {
  if (link.consumedAt) return "consumed";
  if (link.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

/** Counted over links asked for, not links sent, so the limit cannot be drained by a mailer that is down. */
export function withinRequestLimit(recentRequests: number): boolean {
  return recentRequests < MAX_REQUESTS;
}

export function requestWindowStart(now: Date): Date {
  return new Date(now.getTime() - REQUEST_WINDOW_MS);
}
