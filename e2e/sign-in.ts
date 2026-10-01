import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

/** Where playwright.config.ts sends the server's output, and so where the sign-in links land. */
export const SERVER_LOG = fileURLToPath(new URL("../test-results/server.log", import.meta.url));

/**
 * Signs in the way the README tells a developer to: type the address, take the
 * link off the terminal, click it.
 *
 * Reading a log is not elegant, and it is the only place the link exists
 * outside a mailbox — the database holds its SHA-256 and nothing else, which
 * is the property `tests/integration.test.ts` pins and a convenience here must
 * not quietly depend on being untrue. So the suite stays outside the process:
 * it mints no token and issues no session, and what the specs run against is
 * the session `/api/auth/callback` itself handed the browser.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  const alreadyLogged = (await readLog()).length;

  await page.goto("/en/login");
  await page.locator('input[type="email"]').fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  const url = new URL(await linkSentTo(email, alreadyLogged));
  // Relative, so only the browser has to agree with where the suite is serving.
  await page.goto(`${url.pathname}${url.search}`);
}

const LINK = /https?:\/\/\S*[?&]token=\S+/;

async function linkSentTo(email: string, from: number): Promise<string> {
  let sent: string | undefined;
  await expect
    .poll(
      async () => {
        // Only what this request added: an earlier run's links are still above it.
        const tail = (await readLog()).slice(from);
        const at = tail.lastIndexOf(email);
        sent = at === -1 ? undefined : LINK.exec(tail.slice(at))?.[0];
        return sent;
      },
      { message: `no sign-in link for ${email} in ${SERVER_LOG}`, timeout: 10_000 },
    )
    .toBeDefined();
  return sent!;
}

async function readLog(): Promise<string> {
  return readFile(SERVER_LOG, "utf8").catch(() => "");
}
