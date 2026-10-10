import { describe, expect, it } from "vitest";
import { FLOW_TTL_MS, acceptProfile, displayName, flowStatus, stateMatches } from "@/domain/oauth";

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
