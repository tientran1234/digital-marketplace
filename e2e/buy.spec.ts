/**
 * Buy → webhook → download, in the browser.
 *
 * What this covers that `tests/integration.test.ts` cannot: the button posting
 * to the checkout route, the redirect the provider is handed, the webhook
 * arriving as raw signed bytes over HTTP, and the file coming back through the
 * download route to a browser that then has it on disk.
 */
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { db } from "@/lib/db";
import { FakeBillingProvider } from "@/providers/fake";
import { seedDocs } from "../scripts/seed-docs";
import { signIn } from "./sign-in";

const doc = seedDocs.find((d) => d.priceMinor > 0)!;

test("a paid product opens only once its webhook has arrived", async ({ context, page }) => {
  const product = await db.product.findUniqueOrThrow({ where: { slug: doc.slug } });
  await signIn(page, "buyer@example.test");

  // Nothing is hosted at the provider's checkout and nothing needs to be:
  // what matters is that the browser was sent there with our order's id.
  await page.route("https://fake.checkout/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>checkout</h1>" }));

  await test.step("the file is shut to a buyer who has not paid", async () => {
    await page.goto(`/en/p/${doc.slug}`);
    await expect(page.getByRole("link", { name: "Download" })).toHaveCount(0);
    // Asked for from inside the page, so the session cookie goes with it: what
    // is being checked is the route's own gate, not the page declining to
    // render a link to it.
    expect(await getFromPage(page, `/api/products/${product.id}/download`)).toEqual({ status: 403, error: "not_purchased" });
  });

  const checkoutRef = await test.step("buying leaves a PENDING order behind before the redirect", async () => {
    await page.getByRole("button", { name: /^Buy for/ }).click();
    await page.waitForURL(/^https:\/\/fake\.checkout\//);

    const ref = new URL(page.url()).pathname.slice(1);
    expect(await db.order.findUniqueOrThrow({ where: { checkoutRef: ref } })).toMatchObject({
      status: "PENDING",
      productId: product.id,
      amountMinor: doc.priceMinor,
    });
    return ref;
  });

  await test.step("the webhook pays it, and a replay of the same delivery does not", async () => {
    const body = JSON.stringify({ providerEventId: "evt_e2e_paid", type: "order_paid", checkoutRef, providerRef: "pi_e2e" });
    const deliver = () =>
      context.request.post("/api/webhooks/stripe", {
        headers: { "content-type": "application/json", "stripe-signature": new FakeBillingProvider().sign(body) },
        data: body,
      });

    expect(await (await deliver()).json()).toMatchObject({ outcome: "transitioned" });
    expect(await (await deliver()).json()).toMatchObject({ outcome: "duplicate" });
    expect(await db.order.count({ where: { checkoutRef, status: "PAID" } })).toBe(1);
  });

  await test.step("and now the buyer has the file", async () => {
    await page.goto(`/en/p/${doc.slug}`);
    await expect(page.getByText("You own this")).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download" }).click()]);
    expect(download.suggestedFilename()).toBe(`${doc.slug}.md`);
    expect(await readFile(await download.path(), "utf8")).toBe(doc.text);
  });
});

test("an unsigned delivery changes nothing", async ({ request }) => {
  const body = JSON.stringify({ providerEventId: "evt_e2e_forged", type: "order_paid", checkoutRef: "cs_fake_whatever" });
  const response = await request.post("/api/webhooks/stripe", {
    headers: { "content-type": "application/json", "stripe-signature": "not-a-signature" },
    data: body,
  });

  expect(response.status()).toBe(400);
  // Rejected before the idempotency gate, so the id a real delivery will
  // arrive on is still unclaimed.
  expect(await db.webhookEvent.count({ where: { providerEventId: "evt_e2e_forged" } })).toBe(0);
});

/** The session cookie is `secure`, which Playwright's own request client will not send over http. */
async function getFromPage(page: Page, url: string): Promise<{ status: number; error?: string }> {
  return page.evaluate(async (target) => {
    const response = await fetch(target);
    return { status: response.status, error: ((await response.json()) as { error?: string }).error };
  }, url);
}
