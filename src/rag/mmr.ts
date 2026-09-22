export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface Candidate<T> {
  item: T;
  vector: readonly number[];
  /** Similarity to the query, already computed by the store. */
  score: number;
}

/**
 * Maximal Marginal Relevance: pick the next passage that is relevant to the
 * query AND different from what is already picked. Top-k by similarity alone
 * returns five near-duplicate paragraphs about the same point; MMR returns the
 * point plus the four other things the document says that matter.
 *
 * lambda = 1 is pure relevance, 0 is pure diversity. 0.7 is a sane default.
 */
export function mmr<T>(query: readonly number[], candidates: Candidate<T>[], k: number, lambda = 0.7): Candidate<T>[] {
  const remaining = candidates.slice();
  const picked: Candidate<T>[] = [];
  while (picked.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i]!;
      const relevance = c.score || cosine(query, c.vector);
      const redundancy = picked.length ? Math.max(...picked.map((p) => cosine(c.vector, p.vector))) : 0;
      const s = lambda * relevance - (1 - lambda) * redundancy;
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
    picked.push(remaining.splice(bestIdx, 1)[0]!);
  }
  return picked;
}
