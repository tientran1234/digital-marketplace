/** 1-based position in each input list, `null` where that list did not return the item. */
export type Ranks = (number | null)[];

export interface Fused<T> {
  key: string;
  /** The copy from the list that ranked it best — the arm with the most to say about it. */
  item: T;
  score: number;
  ranks: Ranks;
}

/** The constant from the paper. It dampens the top of every list by the same amount. */
export const RRF_K = 60;

/**
 * Reciprocal rank fusion: merge rankings whose scores share no unit.
 *
 * A cosine similarity of 0.42 and a `ts_rank` of 0.08 cannot be added,
 * averaged or weighted into anything meaningful — different scales, different
 * distributions, and both move when the corpus does. RRF throws the scores
 * away and keeps only the positions: an item is worth `1 / (k + rank)` in
 * every list it appears in, and the sum is the fused score. So a listing both
 * arms put third beats one that a single arm put first, which is the reason to
 * run two arms at all.
 */
export function reciprocalRankFusion<T>(lists: readonly (readonly T[])[], key: (item: T) => string, k = RRF_K): Fused<T>[] {
  const fused = new Map<string, Fused<T>>();
  const best = new Map<string, number>();

  lists.forEach((list, list_i) => {
    list.forEach((item, item_i) => {
      const rank = item_i + 1;
      const id = key(item);
      let entry = fused.get(id);
      if (!entry) {
        entry = { key: id, item, score: 0, ranks: lists.map(() => null) };
        fused.set(id, entry);
      }
      // One list returning the same key twice is a duplicate in the caller's
      // query, not a reason to pay the item twice for appearing once.
      if (entry.ranks[list_i] !== null) return;
      entry.ranks[list_i] = rank;
      entry.score += 1 / (k + rank);
      if (rank < (best.get(id) ?? Infinity)) {
        best.set(id, rank);
        entry.item = item;
      }
    });
  });

  // Ties broken by key so two runs over the same corpus return the same order.
  return [...fused.values()].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}
