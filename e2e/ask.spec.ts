/**
 * Ask → cited answer, in the browser.
 *
 * The stand-in model can only quote what `search_docs` handed it, so an
 * answer carrying a passage out of the seller's document is evidence that the
 * whole path ran: SSE out of the route, the tool call back into pgvector, the
 * citation numbers, and the meter moving once.
 */
import { expect, test } from "@playwright/test";
import { db } from "@/lib/db";
import { seedDocs } from "../scripts/seed-docs";
import { signIn } from "./sign-in";

const doc = seedDocs.find((d) => d.priceMinor > 0)!;
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

test("the assistant answers out of the product's own document", async ({ page }) => {
  const product = await db.product.findUniqueOrThrow({ where: { slug: doc.slug } });
  await signIn(page, "buyer@example.test");
  await page.goto(`/en/p/${doc.slug}`);
  await expect(page.getByText("0 of 20 AI messages used this month")).toBeVisible();

  await page.getByPlaceholder("What does chapter 3 cover?").fill("How many plans should I offer?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  // The chip is the agent's own search_docs call, arriving over SSE ahead of
  // the answer — the ask box has no other way to know a tool ran.
  await expect(page.locator(".chips .tag")).toHaveText(["search_docs ✓"]);

  const answer = page.locator(".answer");
  await expect(answer).toContainText("[1]");

  const chunks = await db.productChunk.findMany({ where: { productId: product.id }, select: { content: true } });
  const cited = flat((await answer.innerText()).replace(/^\[1]\s*/, "").split(/\s*\[2]\s*/)[0]!);
  expect(cited).not.toBe("");
  expect(chunks.map((c) => flat(c.content)).some((content) => content.includes(cited))).toBe(true);

  await test.step("the run is on the record, and the message is paid for", async () => {
    await expect
      .poll(() => db.agentTrace.findFirst({ where: { productId: product.id }, select: { status: true, toolCalls: true, modelCalls: true } }))
      .toEqual({ status: "ok", toolCalls: 1, modelCalls: 2 });

    await page.reload();
    await expect(page.getByText("1 of 20 AI messages used this month")).toBeVisible();
  });
});
