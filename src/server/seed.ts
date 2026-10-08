import type { PrismaClient } from "@prisma/client";
import { HashEmbedder, indexProduct } from "@/rag";
import { saveFile } from "@/server/storage";
// The corpus the eval suite asks its questions about, kept where it was so
// the two cannot drift: a fresh install gets the documents the evals score.
import { seedDocs } from "../../scripts/seed-docs";

/**
 * The demo data, as a function rather than only a script. `pnpm db:seed` is a
 * shell command and a deployment has no shell to run it from, so first-boot
 * seeding (`server/bootstrap.ts`) needs the same work reachable from inside
 * the running app — one implementation, so a preview deployment and a laptop
 * cannot be seeded differently.
 *
 * Idempotent: products are upserted by slug and users by address, so running
 * it over a database that already has the demo data leaves one copy.
 */
export interface SeedSummary {
  products: number;
  chunks: number;
}

export async function seedDemoData(db: PrismaClient, log: (line: string) => void = () => {}): Promise<SeedSummary> {
  const admin = await db.user.upsert({ where: { email: "admin@example.test" }, update: {}, create: { email: "admin@example.test", name: "Admin", role: "ADMIN" } });
  const seller = await db.user.upsert({ where: { email: "seller@example.test" }, update: {}, create: { email: "seller@example.test", name: "Linh (seller)", role: "SELLER" } });
  await db.user.upsert({ where: { email: "buyer@example.test" }, update: {}, create: { email: "buyer@example.test", name: "Buyer", role: "BUYER" } });

  const embedder = new HashEmbedder();
  let chunkCount = 0;
  for (const d of seedDocs) {
    const product = await db.product.upsert({
      where: { slug: d.slug },
      update: { status: "PUBLISHED" },
      create: { sellerId: seller.id, slug: d.slug, title: d.title, description: d.description, priceMinor: d.priceMinor, status: "PUBLISHED", fileName: `${d.slug}.md` },
    });
    const fileKey = await saveFile(product.id, `${d.slug}.md`, new TextEncoder().encode(d.text));
    await db.product.update({ where: { id: product.id }, data: { fileKey } });
    const chunks = await indexProduct(product.id, d.text, embedder);
    chunkCount += chunks.length;
    log(`${d.slug}: ${chunks.length} chunks`);
  }

  log(`seeded. admin=${admin.email} seller=${seller.email} buyer=buyer@example.test`);
  return { products: seedDocs.length, chunks: chunkCount };
}
