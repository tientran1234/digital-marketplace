import { describe, expect, it } from "vitest";
import { LINK_TTL_MS, MAX_REQUESTS, linkStatus, requestWindowStart, withinRequestLimit } from "@/domain/magic-link";
import { logMailer, selectMailer } from "@/server/mail";
import { resendMailer } from "@/providers/resend";
import { hashLoginToken, signInEmail, signInUrl } from "@/server/magic-link";

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

describe("the link in the email", () => {
  it("points at the callback and carries the token", () => {
    const url = new URL(signInUrl("https://shop.example", "tok_123"));
    expect(url.origin).toBe("https://shop.example");
    expect(url.pathname).toBe("/api/auth/callback");
    expect(url.searchParams.get("token")).toBe("tok_123");
  });

  /** The row is a fingerprint of the link, not a copy of it: a dump of the table must not be a pile of working links. */
  it("stores a hash the token cannot be read back out of", () => {
    const hash = hashLoginToken("tok_123");
    expect(hash).not.toContain("tok_123");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLoginToken("tok_123")).toBe(hash);
    expect(hashLoginToken("tok_124")).not.toBe(hash);
  });

  it("writes the mail in the locale that asked for it", () => {
    const link = signInUrl("https://shop.example", "tok_123");
    expect(signInEmail("en", link).text).toContain(link);
    expect(signInEmail("vi", link).text).toContain(link);
    expect(signInEmail("vi", link).subject).not.toBe(signInEmail("en", link).subject);
  });
});

describe("choosing a mailer", () => {
  it("logs when nothing is configured and sends when everything is", () => {
    expect(selectMailer({}).name).toBe("log");
    expect(selectMailer({ RESEND_API_KEY: "re_1", MAIL_FROM: "no-reply@shop.example" }).name).toBe("resend");
  });

  /** Falling back here would look like a working sign-in page whose links only ever reach a log. */
  it("refuses to fall back when it is half configured", () => {
    expect(() => selectMailer({ RESEND_API_KEY: "re_1" })).toThrow(/MAIL_FROM/);
    expect(() => selectMailer({ MAIL_FROM: "no-reply@shop.example" })).toThrow(/RESEND_API_KEY/);
  });

  it("puts the whole message where it can be read", async () => {
    const lines: string[] = [];
    await logMailer((line) => lines.push(line)).send({ to: "a@b.test", subject: "Your sign-in link", text: "https://shop.example/x" });
    expect(lines.join("")).toContain("a@b.test");
    expect(lines.join("")).toContain("https://shop.example/x");
  });
});

describe("resend", () => {
  const sent = (impl: typeof fetch) => resendMailer({ apiKey: "re_1", from: "no-reply@shop.example" }, impl);

  it("posts the message as the API wants it", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    await sent((async (url, init) => {
      seen = { url: String(url), init: init! };
      return new Response(null, { status: 200 });
    }) as typeof fetch).send({ to: "a@b.test", subject: "Hi", text: "link" });

    const { url, init } = seen!;
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_1");
    expect(JSON.parse(init.body as string)).toEqual({ from: "no-reply@shop.example", to: ["a@b.test"], subject: "Hi", text: "link" });
  });

  /** A swallowed rejection is a sign-in that never happens and nothing to say why. */
  it("throws when the send is rejected", async () => {
    const fail = sent((async () => new Response("no such domain", { status: 422 })) as typeof fetch);
    await expect(fail.send({ to: "a@b.test", subject: "Hi", text: "link" })).rejects.toThrow(/422/);
  });
});
