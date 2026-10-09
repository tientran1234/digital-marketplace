/**
 * Marketplace search: find a listing by what it says about itself and by what
 * is inside the document it sells.
 *
 * Two arms, neither of them enough alone. Postgres full-text is the precise
 * one: every word a buyer typed has to appear, stemmed, somewhere in the
 * title, the description or an indexed chunk — so "archiving rules" reaches a
 * passage headed "Archive rules", and a query no document contains a word of
 * returns nothing at all. pgvector is the forgiving one: it answers every
 * query, matches meaning rather than words, and in exchange it cannot say
 * "nothing". Reciprocal rank fusion puts the two orderings together without
 * pretending a `ts_rank` and a cosine similarity share a unit.
 *
 * Neither arm has an index, for the same reason the embeddings have none: the
 * corpus is a few hundred chunks, and a sequential scan over them costs less
 * than the planner spends deciding not to. A GIN index on the chunk tsvector
 * is the first thing to add when that stops being true.
 */
import { pool } from "@/lib/pg";
import { reciprocalRankFusion, toVectorLiteral, type Embedder } from "@/rag";
import { embedder as defaultEmbedder } from "./assistant";

/** Postgres has no Vietnamese configuration; localised listings will need one arm per locale. */
const FTS_CONFIG = "english";

export type SearchArm = "text" | "vector";
export const SEARCH_ARMS: readonly SearchArm[] = ["text", "vector"];

export interface SearchHit {
  productId: string;
  /** Heading of the passage that matched, null when the listing's own text is what matched. */
  heading: string | null;
  /** The fused score. Comparable inside one result set and nowhere else. */
  score: number;
  /** 1-based rank in each arm that ran; null where that arm did not return the product. */
  ranks: Record<SearchArm, number | null>;
}

export interface SearchOptions {
  limit?: number;
  embedder?: Embedder;
  /** Which arms to run. Both by default; the eval suite scores each alone to show what fusing them buys. */
  arms?: readonly SearchArm[];
  /**
   * The language the buyer is reading the marketplace in, which decides whose
   * words the lexical arm matches: the seller's translation for this locale
   * where there is one, the listing's own text where there is not. A locale
   * nothing is translated into searches the listings' own text, which is what
   * every locale did before any of them had a translation.
   */
  locale?: string;
}

interface ArmHit {
  productId: string;
  heading: string | null;
}

/**
 * Published listings for a buyer's query, best first. An empty query is not a
 * search for everything: the caller shows the grid instead.
 */
export async function searchProducts(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
  const text = query.trim();
  if (!text) return [];
  const limit = options.limit ?? 12;
  const arms = options.arms ?? SEARCH_ARMS;
  // Each arm looks wider than the result set: a listing that is third in one
  // arm and nowhere near the top of the other still belongs in the answer.
  const candidates = Math.max(limit * 4, 24);

  const lists = await Promise.all(
    arms.map((arm) => (arm === "text" ? textArm(text, candidates) : vectorArm(text, candidates, options.embedder ?? defaultEmbedder()))),
  );

  return reciprocalRankFusion(lists, (hit) => hit.productId)
    .slice(0, limit)
    .map((fused) => ({
      productId: fused.item.productId,
      heading: fused.item.heading,
      score: fused.score,
      ranks: {
        text: rankIn(arms, fused.ranks, "text"),
        vector: rankIn(arms, fused.ranks, "vector"),
      },
    }));
}

const rankIn = (arms: readonly SearchArm[], ranks: (number | null)[], arm: SearchArm) => {
  const at = arms.indexOf(arm);
  return at === -1 ? null : ranks[at] ?? null;
};

/**
 * Full text over the listing and over its chunks, best match per listing.
 *
 * The listing's title and description are one searchable unit and each chunk
 * is another, which is what lets a query that only occurs on page nine find a
 * product whose description never mentions it. `websearch_to_tsquery` takes
 * what a buyer types — bare words, quoted phrases, a stray `or` — and a query
 * that stems to nothing matches nothing rather than everything.
 */
async function textArm(query: string, limit: number): Promise<ArmHit[]> {
  const { rows } = await pool().query<ArmHit>(
    `WITH tsq AS (SELECT websearch_to_tsquery('${FTS_CONFIG}', $1) AS q),
          hits AS (
            SELECT p.id AS "productId", NULL::text AS heading,
                   ts_rank(to_tsvector('${FTS_CONFIG}', p.title || ' ' || p.description), tsq.q) AS score
              FROM "Product" p CROSS JOIN tsq
             WHERE p.status = 'PUBLISHED'
               AND to_tsvector('${FTS_CONFIG}', p.title || ' ' || p.description) @@ tsq.q
            UNION ALL
            SELECT c."productId", c.heading,
                   ts_rank(to_tsvector('${FTS_CONFIG}', c.content), tsq.q) AS score
              FROM "ProductChunk" c
              JOIN "Product" p ON p.id = c."productId"
              CROSS JOIN tsq
             WHERE p.status = 'PUBLISHED'
               AND to_tsvector('${FTS_CONFIG}', c.content) @@ tsq.q
          ),
          best AS (
            SELECT DISTINCT ON ("productId") "productId", heading, score
              FROM hits
             ORDER BY "productId", score DESC
          )
     SELECT "productId", heading FROM best ORDER BY score DESC, "productId" LIMIT $2`,
    [query, limit],
  );
  return rows;
}

/** Nearest chunks across the published corpus, collapsed to the best one per listing. */
async function vectorArm(query: string, limit: number, embedder: Embedder): Promise<ArmHit[]> {
  const [vector] = await embedder.embed([query], "query");
  if (!vector) return [];
  const { rows } = await pool().query<ArmHit>(
    `WITH nearest AS (
            SELECT c."productId", c.heading, 1 - (c.embedding <=> $1::vector) AS score
              FROM "ProductChunk" c
              JOIN "Product" p ON p.id = c."productId"
             WHERE p.status = 'PUBLISHED' AND c.embedding IS NOT NULL
             ORDER BY c.embedding <=> $1::vector
             LIMIT $2
          ),
          best AS (
            SELECT DISTINCT ON ("productId") "productId", heading, score
              FROM nearest
             ORDER BY "productId", score DESC
          )
     SELECT "productId", heading FROM best ORDER BY score DESC, "productId" LIMIT $3`,
    [toVectorLiteral(vector), limit * 3, limit],
  );
  return rows;
}
