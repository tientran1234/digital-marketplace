import { randomUUID } from "node:crypto";
import { pool } from "@/lib/pg";
import { chunkDocument, type Chunk } from "./chunk";
import type { Embedder } from "./embed";

/** Index (or re-index) a product's document. Replaces existing chunks atomically. */
export async function indexProduct(productId: string, text: string, embedder: Embedder): Promise<Chunk[]> {
  const chunks = chunkDocument(text);
  const vectors = await embedder.embed(chunks.map((c) => c.content), "document");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query('DELETE FROM "ProductChunk" WHERE "productId" = $1', [productId]);
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      await client.query(
        'INSERT INTO "ProductChunk" (id, "productId", ordinal, heading, content, "tokenCount", embedding) VALUES ($1, $2, $3, $4, $5, $6, $7::vector)',
        [randomUUID(), productId, c.ordinal, c.heading, c.content, c.tokenCount, toVectorLiteral(vectors[i]!)],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return chunks;
}

export interface StoredChunk {
  id: string;
  ordinal: number;
  heading: string | null;
  content: string;
  vector: number[];
  score: number;
}

/** Nearest chunks by cosine distance (`<=>`), vectors included so MMR can re-rank. */
export async function nearestChunks(productId: string, query: number[], limit: number): Promise<StoredChunk[]> {
  const { rows } = await pool().query<{ id: string; ordinal: number; heading: string | null; content: string; embedding: string; score: number }>(
    `SELECT id, ordinal, heading, content, embedding::text AS embedding, 1 - (embedding <=> $1::vector) AS score
       FROM "ProductChunk"
      WHERE "productId" = $2 AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [toVectorLiteral(query), productId, limit],
  );
  return rows.map((r) => ({ ...r, score: Number(r.score), vector: fromVectorLiteral(r.embedding) }));
}

export const toVectorLiteral = (v: readonly number[]) => `[${v.join(",")}]`;
export const fromVectorLiteral = (s: string) => s.slice(1, -1).split(",").map(Number);
