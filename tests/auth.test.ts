import { describe, expect, it } from "vitest";
import { LINK_TTL_MS, MAX_REQUESTS, linkStatus, requestWindowStart, withinRequestLimit } from "@/domain/magic-link";

const at = (ms: number) => new Date(ms);

describe("sign-in link rules", () => {
  const issued = at(1_000_000);
  const expiresAt = at(issued.getTime() + LINK_TTL_MS);

  it("is valid until the moment it expires, and not on it", () => {
    expect(linkStatus({ consumedAt: null, expiresAt }, issued)).toBe("valid");
    expect(linkStatus({ consumedAt: null, expiresAt: at(expiresAt.getTime()) }, at(expiresAt.getTime() - 1))).toBe("valid");
    expect(linkStatus({ consumedAt: null, expiresAt }, expiresAt)).toBe("expired");
    expect(linkStatus({ consumedAt: null, expiresAt }, at(expiresAt.getTime() + 1))).toBe("expired");
  });

  /** A spent link must not start reading as "expired" once its window passes — that is an invitation to ask for another one. */
  it("stays consumed after it would also have expired", () => {
    const consumed = { consumedAt: issued, expiresAt };
    expect(linkStatus(consumed, issued)).toBe("consumed");
    expect(linkStatus(consumed, at(expiresAt.getTime() + 86_400_000))).toBe("consumed");
  });

  it("lets a mailbox ask a few times and then stops", () => {
    expect(withinRequestLimit(0)).toBe(true);
    expect(withinRequestLimit(MAX_REQUESTS - 1)).toBe(true);
    expect(withinRequestLimit(MAX_REQUESTS)).toBe(false);
    expect(withinRequestLimit(MAX_REQUESTS + 1)).toBe(false);
  });

  it("counts requests over a window that ends now", () => {
    const now = at(2_000_000);
    expect(requestWindowStart(now).getTime()).toBeLessThan(now.getTime());
  });
});
