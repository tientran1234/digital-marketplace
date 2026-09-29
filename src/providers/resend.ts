/** The only file that knows Resend's API. One POST, no SDK — the same trade as `providers/s3.ts`. */
export type ResendConfig = { apiKey: string; from: string };

export function resendMailer(config: ResendConfig, fetchImpl: typeof fetch = fetch) {
  return {
    async send(message: { to: string; subject: string; text: string }): Promise<void> {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, text: message.text }),
      });
      // A link nobody received is a sign-in that silently never happens, so a
      // rejected send is an error here rather than a logged line.
      if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    },
  };
}
