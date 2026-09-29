import { resendMailer } from "@/providers/resend";
import { env } from "@/lib/env";

/**
 * Where a sign-in link goes: Resend when it is configured, the server's own
 * log otherwise. The log is the dev default — `pnpm dev` prints the link and
 * you click it, which is what the dev login route used to be, without a route
 * that signs anyone in as anyone.
 *
 * Text only. A sign-in email is one sentence and a URL; an HTML template is a
 * thing to maintain and a thing mail clients rewrite, and a rewritten link is
 * a sign-in that fails for reasons nobody can see.
 */
export type Email = { to: string; subject: string; text: string };

export type Mailer = {
  readonly name: "log" | "resend";
  send(message: Email): Promise<void>;
};

/** The settings that decide the backend, kept narrow so the choice can be exercised without a whole environment. */
export type MailEnv = Partial<Record<"RESEND_API_KEY" | "MAIL_FROM", string>>;

export function logMailer(write: (line: string) => void = console.log): Mailer {
  return {
    name: "log",
    async send(message) {
      write(`\n── ${message.subject} → ${message.to} ──\n${message.text}\n`);
    },
  };
}

/**
 * Half-configured is an error rather than a quiet fall back to the log, for
 * the same reason half-configured object storage is: on a deployment the
 * fallback looks like a working sign-in page whose links only ever reach a
 * log file nobody is reading.
 */
export function selectMailer(e: MailEnv): Mailer {
  const required = ["RESEND_API_KEY", "MAIL_FROM"] as const;
  const missing = required.filter((name) => !e[name]);
  if (missing.length === required.length) return logMailer();
  if (missing.length) throw new Error(`mail is half-configured: ${missing.join(", ")} missing`);
  return { name: "resend", ...resendMailer({ apiKey: e.RESEND_API_KEY!, from: e.MAIL_FROM! }) };
}

let override: Mailer | null = null;
let cached: Mailer | null = null;

/** Tests inject a mailer here. */
export function setMailerForTests(m: Mailer | null) {
  override = m;
  cached = null;
}

export function mailer(): Mailer {
  if (override) return override;
  if (!cached) cached = selectMailer(env());
  return cached;
}
