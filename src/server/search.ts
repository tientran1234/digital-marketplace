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
 * The lexical arm searches the words the reader in front of it will actually
 * be shown: the seller's translation for their locale where there is one, the
 * listing's own text where there is not, which is the same resolution
 * `domain/listing.ts` does for the card. So a listing never comes back for
 * words that are not in the card the buyer ends up looking at, and a
 * Vietnamese query reaches a title only a `ProductTranslation` row holds.
 *
 * Neither arm has an index, for the same reason the embeddings have none: the
 * corpus is a few hundred chunks, and a sequential scan over them costs less
 * than the planner spends deciding not to. A GIN index on the chunk tsvector
 * is the first thing to add when that stops being true — one per
 * configuration, now that which configuration a row is indexed in depends on
 * the language its words are in.
 */
import { pool } from "@/lib/pg";
import { defaultLocale, type Locale } from "@/i18n";
import { reciprocalRankFusion, toVectorLiteral, type Embedder } from "@/rag";
import { embedder as defaultEmbedder } from "./assistant";

/**
 * The text search configuration each locale's words are indexed and queried
 * in. Postgres ships no Vietnamese one, and `simple` is a stand-in rather than
 * a shrug: Vietnamese words do not inflect, so a stemmer has nothing to strip,
 * and all `english` would add on top is its stop word list — which swallows
 * `an`, `do` and `can`, every one of them an ordinary Vietnamese word. A
 * Vietnamese query made of those finds nothing at all, and one built around
 * them is left matching on whatever words survived.
 */
const FTS_CONFIGS: Record<Locale, string> = { en: "english", vi: "simple" };

/**
 * `Product.locale` and `ProductTranslation.locale` are free strings, so a row
 * can carry a language this map has never heard of. Indexing it unstemmed
 * finds less than the right configuration would; leaving it out of the join
 * would hide the listing from the lexical arm altogether.
 */
const FALLBACK_CONFIG = "simple";

/**
 * The two lists the lexical arm's SQL needs spelled out: locale-to-
 * configuration pairs, and every configuration to build a `tsquery` in. Both
 * come from the constants above — never from anything a buyer typed.
 */
const LOCALE_CONFIGS = Object.entries(FTS_CONFIGS)
  .map(([locale, config]) => `('${locale}','${config}')`)
  .join(", ");
const CONFIGS = [...new Set([...Object.values(FTS_CONFIGS), FALLBACK_CONFIG])].map((config) => `('${config}')`).join(", ");

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
   * words the lexical arm matches against — see the note at the top. A locale
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

  const locale = options.locale ?? defaultLocale;

  const lists = await Promise.all(
    arms.map((arm) => (arm === "text" ? textArm(text, candidates, locale) : vectorArm(text, candidates, options.embedder ?? defaultEmbedder()))),
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
 * The listing's text for this reader is one searchable unit and each chunk is
 * another, which is what lets a query that only occurs on page nine find a
 * product whose description never mentions it. Each unit is indexed in the
 * configuration for the language it is written in — the reader's where a
 * translation answered, the listing's own where it fell back, and the
 * listing's for the document, since that is the language the seller uploaded
 * it in. `websearch_to_tsquery` takes what a buyer types — bare words, quoted
 * phrases, a stray `or` — and a query that stems to nothing matches nothing
 * rather than everything.
 *
 * The one place a `ts_rank` from two configurations meets another is the order
 * below, which picks the best passage per listing and nothing else: fusion
 * reads positions, so the two never have to share a unit.
 */
async function textArm(query: string, limit: number, locale: string): Promise<ArmHit[]> {
  const { rows } = await pool().query<ArmHit>(
    `WITH cfg(locale, config) AS (VALUES ${LOCALE_CONFIGS}),
          tsq(config, q) AS (
            SELECT config, websearch_to_tsquery(config::regconfig, $1) FROM (VALUES ${CONFIGS}) AS c(config)
          ),
          listing AS (
            SELECT p.id AS "productId",
                   COALESCE(t.title, p.title) || ' ' || COALESCE(t.description, p.description) AS words,
                   -- A translation row is written whole or not at all, so the
                   -- pair is in one language and so is the locale naming it.
                   COALESCE(t.locale, p.locale) AS locale
              FROM "Product" p
              LEFT JOIN "ProductTranslation" t ON t."productId" = p.id AND t.locale = $2
             WHERE p.status = 'PUBLISHED'
          ),
          hits AS (
            SELECT l."productId", NULL::text AS heading,
                   ts_rank(to_tsvector(tsq.config::regconfig, l.words), tsq.q) AS score
              FROM listing l
              LEFT JOIN cfg ON cfg.locale = l.locale
              JOIN tsq ON tsq.config = COALESCE(cfg.config, '${FALLBACK_CONFIG}')
             WHERE to_tsvector(tsq.config::regconfig, l.words) @@ tsq.q
            UNION ALL
            SELECT ch."productId", ch.heading,
                   ts_rank(to_tsvector(tsq.config::regconfig, ch.content), tsq.q) AS score
              FROM "ProductChunk" ch
              JOIN "Product" p ON p.id = ch."productId"
              LEFT JOIN cfg ON cfg.locale = p.locale
              JOIN tsq ON tsq.config = COALESCE(cfg.config, '${FALLBACK_CONFIG}')
             WHERE p.status = 'PUBLISHED'
               AND to_tsvector(tsq.config::regconfig, ch.content) @@ tsq.q
          ),
          best AS (
            SELECT DISTINCT ON ("productId") "productId", heading, score
              FROM hits
             ORDER BY "productId", score DESC
          )
     SELECT "productId", heading FROM best ORDER BY score DESC, "productId" LIMIT $3`,
    [query, locale, limit],
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
