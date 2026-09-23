import type { Embedder } from "./embed";
import { mmr } from "./mmr";
import { nearestChunks, type StoredChunk } from "./store";

export interface Passage {
  /** 1-based, for citations like [2]. */
  index: number;
  heading: string | null;
  content: string;
  score: number;
}

/**
 * Where the candidate chunks come from. Defaults to pgvector; the eval harness
 * swaps in an in-memory scan so the suite runs with no database, over the same
 * embedder, MMR and citation numbering the product uses.
 */
export type ChunkSearch = (productId: string, query: number[], limit: number) => Promise<StoredChunk[]>;

export interface RetrieveOptions {
  k?: number;
  fetchK?: number;
  search?: ChunkSearch;
}

/**
 * Embed the question, pull a wider candidate set, re-rank with MMR, return
 * the top k with citation indexes.
 */
export async function retrieve(productId: string, question: string, embedder: Embedder, options: RetrieveOptions = {}): Promise<Passage[]> {
  const k = options.k ?? 5;
  const fetchK = options.fetchK ?? Math.max(k * 3, 12);
  const search = options.search ?? nearestChunks;
  const [query] = await embedder.embed([question], "query");
  if (!query) return [];
  const candidates = await search(productId, query, fetchK);
  const picked = mmr(query, candidates.map((c) => ({ item: c, vector: c.vector, score: c.score })), k);
  return picked.map((p, i) => ({ index: i + 1, heading: p.item.heading, content: p.item.content, score: p.score }));
}
