/** Demo data: three users, two published products with indexed docs. No API keys needed. */
import { PrismaClient } from "@prisma/client";
import { HashEmbedder, indexProduct } from "../src/rag/index.js";
import { saveFile } from "../src/server/storage.js";

const db = new PrismaClient();

const admin = await db.user.upsert({ where: { email: "admin@example.test" }, update: {}, create: { email: "admin@example.test", name: "Admin", role: "ADMIN" } });
const seller = await db.user.upsert({ where: { email: "seller@example.test" }, update: {}, create: { email: "seller@example.test", name: "Linh (seller)", role: "SELLER" } });
await db.user.upsert({ where: { email: "buyer@example.test" }, update: {}, create: { email: "buyer@example.test", name: "Buyer", role: "BUYER" } });

const docs = [
  {
    slug: "saas-pricing-playbook",
    title: "SaaS Pricing Playbook",
    description: "How to choose plans, price points and quotas for a small SaaS — with worked examples.",
    priceMinor: 1900,
    text: `# SaaS Pricing Playbook

## Why three plans
Three plans give buyers a reference point. The middle plan is the one you want most people on; the top plan exists to make the middle look reasonable.

## Choosing quotas
Quotas should track the cost driver, not the value driver. If AI messages cost you money per call, meter messages. Never meter seats if seats do not cost you anything.

## Refunds
Offer a 14-day refund window with no questions. Refund requests are a signal about onboarding, not about pricing. Track the reason codes.

## Annual billing
Annual plans reduce churn but concentrate cash flow. Discount 15–20 percent and require payment up front.`,
  },
  {
    slug: "notion-second-brain-template",
    title: "Second Brain Notion Template",
    description: "A PARA-based Notion workspace with weekly review checklists. Free.",
    priceMinor: 0,
    text: `# Second Brain Template

## Structure
Four top-level databases: Projects, Areas, Resources, Archive. Every note links to exactly one of them.

## Weekly review
Every Friday: clear the inbox, move finished projects to Archive, pick three outcomes for next week.

## Capture
Use the mobile shortcut to capture into the inbox. Do not file while capturing.`,
  },
];

const embedder = new HashEmbedder();
for (const d of docs) {
  const product = await db.product.upsert({
    where: { slug: d.slug },
    update: { status: "PUBLISHED" },
    create: { sellerId: seller.id, slug: d.slug, title: d.title, description: d.description, priceMinor: d.priceMinor, status: "PUBLISHED", fileName: `${d.slug}.md` },
  });
  const fileKey = await saveFile(product.id, `${d.slug}.md`, new TextEncoder().encode(d.text));
  await db.product.update({ where: { id: product.id }, data: { fileKey } });
  const chunks = await indexProduct(product.id, d.text, embedder);
  console.log(`${d.slug}: ${chunks.length} chunks`);
}
console.log(`seeded. admin=${admin.email} seller=${seller.email} buyer=buyer@example.test`);
await db.$disconnect();
