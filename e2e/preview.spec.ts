/**
 * Did this deployment come up?
 *
 * The flow specs next door drive the app from inside its own process. This one
 * has nothing but the URL — no database handle, no server log — which is also
 * all a buyer has, and it is enough to tell a deployment that works from one
 * that built. Every question here is answered by the deployment's own
 * database, storage and middleware, so a `DATABASE_URL` that is missing, a
 * bucket that is half-configured or an unseeded Neon branch fails it.
 *
 *   E2E_BASE_URL=https://… pnpm exec playwright test
 *
 * Nothing is asserted about counts or history: a preview accumulates whatever
 * earlier runs left in it, and a spec that insisted on a clean database would
 * have to wipe a deployment to pass.
 */
import { expect, test } from "@playwright/test";
import { seedDocs } from "../scripts/seed-docs";

const paid = seedDocs.find((d) => d.priceMinor > 0)!;

test("the deployment is serving", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, service: "digital-marketplace" });
});

test("the first-boot seed reached the deployment's own database", async ({ page }) => {
  // The first request to a cold deployment waits for the seed: Next awaits
  // `register()` before serving, which is the whole point of doing it there.
  await page.goto("/en");

  for (const doc of seedDocs) {
    await expect(page.getByRole("heading", { name: doc.title, level: 3 })).toBeVisible();
  }
});

test("a listing reads in the language it is asked for", async ({ page }) => {
  // The locale prefix is the middleware's work, which is the one piece of this
  // app that runs on the edge runtime and so is not exercised by the flow specs.
  await page.goto("/vi");
  await expect(page.getByRole("button", { name: "Tìm" })).toBeVisible();

  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
});

test("a stranger is shown the listing and refused the file", async ({ page }) => {
  await page.goto(`/en/p/${paid.slug}`);
  await expect(page.getByRole("heading", { name: paid.title, level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download" })).toHaveCount(0);

  // The route's own gate, not the page declining to render a link to it.
  const checkout = await page.request.post("/api/checkout/order", { data: { productId: "whatever" } });
  expect(checkout.status()).toBe(401);
});

test("an unsigned delivery is refused", async ({ request }) => {
  const response = await request.post("/api/webhooks/stripe", {
    headers: { "content-type": "application/json", "stripe-signature": "not-a-signature" },
    data: JSON.stringify({ providerEventId: "evt_preview_forged", type: "order_paid", checkoutRef: "cs_whatever" }),
  });
  expect(response.status()).toBe(400);
});
