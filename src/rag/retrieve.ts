import type { Embedder } from "./embed";
import { mmr } from "./mmr";
import { nearestChunks } from "./store";

export interface Passage {
  /** 1-based, for citations like [2]. */
  index: number;
  heading: string | null;
  content: string;
  score: number;
}

/**
 * Embed the question, pull a wider candidate set, re-rank with MMR, return
 * the top k with citation indexes.
 */
export async function retrieve(productId: string, question: string, embedder: Embedder, options: { k?: number; fetchK?: number } = {}): Promise<Passage[]> {
  const k = options.k ?? 5;
  const fetchK = options.fetchK ?? Math.max(k * 3, 12);
  const [query] = await embedder.embed([question], "query");
  if (!query) return [];
  const candidates = await nearestChunks(productId, query, fetchK);
  const picked = mmr(query, candidates.map((c) => ({ item: c, vector: c.vector, score: c.score })), k);
  return picked.map((p, i) => ({ index: i + 1, heading: p.item.heading, content: p.item.content, score: p.score }));
}
