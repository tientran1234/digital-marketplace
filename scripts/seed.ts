/** Demo data: three users, two published products with indexed docs. No API keys needed. */
import { PrismaClient } from "@prisma/client";
import { HashEmbedder, indexProduct } from "../src/rag/index.js";
import { saveFile } from "../src/server/storage.js";
import { seedDocs } from "./seed-docs.js";

const db = new PrismaClient();

const admin = await db.user.upsert({ where: { email: "admin@example.test" }, update: {}, create: { email: "admin@example.test", name: "Admin", role: "ADMIN" } });
const seller = await db.user.upsert({ where: { email: "seller@example.test" }, update: {}, create: { email: "seller@example.test", name: "Linh (seller)", role: "SELLER" } });
await db.user.upsert({ where: { email: "buyer@example.test" }, update: {}, create: { email: "buyer@example.test", name: "Buyer", role: "BUYER" } });

const embedder = new HashEmbedder();
for (const d of seedDocs) {
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
