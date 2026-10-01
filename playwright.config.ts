import { defineConfig } from "@playwright/test";

/**
 * The end-to-end suite: the two flows a buyer walks through, in a real
 * browser, against a real build and a real Postgres. Everything the app talks
 * out to — Stripe, the model, the embedder — is the double behind
 * FAKE_PROVIDERS, so the suite needs a database and nothing else.
 *
 *   DATABASE_URL=… SESSION_SECRET=… pnpm test:e2e
 *
 * `@playwright/test` is pinned exactly rather than by range: each release
 * carries the Chromium build it was tested against, and a floating range
 * changes the browser under the suite without changing anything in the repo.
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const appUrl = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  // One database and one seed, so the specs take turns rather than racing for
  // the buyer's quota and the product's order rows.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  globalSetup: "./e2e/seed.ts",
  use: { baseURL: appUrl, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    // A production build: `next dev` compiles on first request, which turns
    // every first navigation into a timeout nobody can tell from a bug.
    //
    // Output goes to a file because the sign-in links go to it: with no mailer
    // configured they are printed, which is the dev default, and e2e/sign-in.ts
    // reads them back from there.
    command: `mkdir -p test-results && pnpm start --port ${port} >> test-results/server.log 2>&1`,
    url: `${appUrl}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      APP_URL: appUrl,
      FAKE_PROVIDERS: "1",
      // Blanked rather than inherited. FAKE_PROVIDERS refuses to stand in
      // front of a real credential, and a developer running the suite has a
      // .env full of them: VOYAGE_API_KEY would embed the buyer's question
      // with a model the seed did not index the document with, and RESEND_API_KEY
      // would mail the sign-in link the suite is waiting to read off the log.
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      ANTHROPIC_API_KEY: "",
      VOYAGE_API_KEY: "",
      RESEND_API_KEY: "",
      MAIL_FROM: "",
    },
  },
});
