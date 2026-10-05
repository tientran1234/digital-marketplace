/**
 * The search-relevance section of the suite: given what a buyer types into
 * the marketplace, does hybrid search put the right listing first — and is
 * running two arms worth more than running either one.
 *
 * Unlike the rest of the suite this section needs a database. The lexical arm
 * *is* Postgres: `websearch_to_tsquery`, the english stemmer, its stop words
 * and `ts_rank`. An in-memory stand-in the way `memoryIndex` stands in for
 * pgvector would be measuring a tokeniser nothing ships, so with no
 * `DATABASE_URL` the section is reported as skipped rather than scored.
 */
import { db } from "../src/lib/db.js";
import { HashEmbedder, indexProduct, type Embedder } from "../src/rag/index.js";
import { searchProducts, type SearchArm } from "../src/server/search.js";
import { seedDocs } from "../scripts/seed-docs.js";

export interface SearchCase {
  id: string;
  query: string;
  /** Slug of the listing that should come first. */
  slug: string;
  /** Heading of the passage the top hit should point at; absent where the listing's own text is the match. */
  passage?: string;
  /** Every word of the query is inside the document only — the title and description cannot answer it. */
  bodyOnly?: boolean;
}

const pricing = (n: number, query: string, rest: Omit<SearchCase, "id" | "query" | "slug">): SearchCase => ({
  id: `search-pricing-${String(n).padStart(2, "0")}`,
  slug: "saas-pricing-playbook",
  query,
  ...rest,
});

const brain = (n: number, query: string, rest: Omit<SearchCase, "id" | "query" | "slug">): SearchCase => ({
  id: `search-brain-${String(n).padStart(2, "0")}`,
  slug: "notion-second-brain-template",
  query,
  ...rest,
});

/**
 * Twenty queries, ten per listing. Three are answered by the listing's own
 * title and description; the rest only by the document behind it, which is the
 * half of the corpus a marketplace that indexes listings alone cannot see.
 */
export const searchCases: SearchCase[] = [
  pricing(1, "saas pricing playbook", {}),
  pricing(2, "fourteen day refund window", { passage: "Refunds", bodyOnly: true }),
  pricing(3, "annual billing discount", { passage: "Annual billing", bodyOnly: true }),
  pricing(4, "grandfathering existing customers", { passage: "Grandfathering", bodyOnly: true }),
  pricing(5, "dunning retries for expired cards", { passage: "Churn and downgrades", bodyOnly: true }),
  pricing(6, "merchant of record and vat", { passage: "Taxes and currency", bodyOnly: true }),
  pricing(7, "keep coupons time boxed", { passage: "Discounts and coupons", bodyOnly: true }),
  pricing(8, "enterprise deal security review", { passage: "Enterprise quotes", bodyOnly: true }),
  pricing(9, "metering messages per call", { passage: "Choosing quotas", bodyOnly: true }),
  pricing(10, "how do I stop customers leaving", { passage: "Churn and downgrades", bodyOnly: true }),
  brain(1, "notion template", {}),
  brain(2, "weekly review checklist", {}),
  brain(3, "archiving rules", { passage: "Archive rules", bodyOnly: true }),
  brain(4, "projects areas resources archive", { passage: "Structure", bodyOnly: true }),
  brain(5, "capture into the inbox", { passage: "Capture", bodyOnly: true }),
  brain(6, "daily note scratchpad", { passage: "Daily notes", bodyOnly: true }),
  brain(7, "offline edits on two devices", { passage: "Syncing and offline", bodyOnly: true }),
  brain(8, "how many projects stay active", { passage: "Projects database", bodyOnly: true }),
  brain(9, "tag resources by topic", { passage: "Resources and tags", bodyOnly: true }),
  brain(10, "an area is not a project", { passage: "Areas database", bodyOnly: true }),
];

/** Queries no document contains a word of. The lexical arm is what can say "nothing". */
export const noiseQueries = ["asdfghjkl qwertyuiop", "wvvzzql", "qqqq zzzz xxxx"];

/** The fused search and each arm on its own, so the fusion's contribution is a number. */
export type ScoredArm = "text" | "vector" | "hybrid";
export const SCORED_ARMS: readonly ScoredArm[] = ["text", "vector", "hybrid"];

const armsOf = (arm: ScoredArm): readonly SearchArm[] => (arm === "hybrid" ? ["text", "vector"] : [arm]);

export interface ArmScore {
  /** Share of cases whose expected listing appeared in the results at all. */
  recall: number;
  /** Share whose expected listing came first. */
  precisionAt1: number;
  /** Mean reciprocal rank of the expected listing; 0 where it was not returned. */
  mrr: number;
  /** Of the cases naming a passage: the top hit is that listing, at that passage. */
  passageAt1: number;
  /** precision@1 over the cases the listing's own text cannot answer. */
  bodyOnlyAt1: number;
}

export interface CaseResult {
  id: string;
  case: SearchCase;
  /** Per arm: 1-based rank of the expected listing, or null. */
  rank: Record<ScoredArm, number | null>;
  /** Per arm: the heading the top hit pointed at. */
  heading: Record<ScoredArm, string | null>;
}

export interface SearchReport {
  embedder: string;
  cases: CaseResult[];
  arms: Record<ScoredArm, ArmScore>;
  /** Share of the noise queries the lexical arm returned nothing for. */
  noiseRejected: number;
}

export interface SearchRunOptions {
  embedder?: Embedder;
  onResult?: (result: CaseResult) => void;
}

/**
 * Upsert the two seed listings as published and index their documents — the
 * same rows `pnpm db:seed` writes, so a dev database is left as the demo
 * rather than full of eval leftovers.
 */
export async function indexSearchCorpus(embedder: Embedder): Promise<Map<string, string>> {
  const seller = await db.user.upsert({
    where: { email: "seller@example.test" },
    update: {},
    create: { email: "seller@example.test", name: "Linh (seller)", role: "SELLER" },
  });
  const bySlug = new Map<string, string>();
  for (const doc of seedDocs) {
    const product = await db.product.upsert({
      where: { slug: doc.slug },
      update: { status: "PUBLISHED" },
      create: { sellerId: seller.id, slug: doc.slug, title: doc.title, description: doc.description, priceMinor: doc.priceMinor, status: "PUBLISHED" },
    });
    await indexProduct(product.id, doc.text, embedder);
    bySlug.set(doc.slug, product.id);
  }
  return bySlug;
}

export async function runSearchEval(options: SearchRunOptions = {}): Promise<SearchReport> {
  const embedder = options.embedder ?? new HashEmbedder();
  const bySlug = await indexSearchCorpus(embedder);
  const slugOf = new Map([...bySlug].map(([slug, id]) => [id, slug]));
  const cases: CaseResult[] = [];

  for (const c of searchCases) {
    const rank: Record<string, number | null> = {};
    const heading: Record<string, string | null> = {};
    for (const arm of SCORED_ARMS) {
      const hits = await searchProducts(c.query, { embedder, arms: armsOf(arm) });
      const at = hits.findIndex((h) => slugOf.get(h.productId) === c.slug);
      rank[arm] = at === -1 ? null : at + 1;
      heading[arm] = hits[0]?.heading ?? null;
    }
    const result = { id: c.id, case: c, rank, heading } as CaseResult;
    cases.push(result);
    options.onResult?.(result);
  }

  let rejected = 0;
  for (const query of noiseQueries) {
    if ((await searchProducts(query, { embedder, arms: ["text"] })).length === 0) rejected++;
  }

  const arms = Object.fromEntries(SCORED_ARMS.map((arm) => [arm, score(cases, arm)])) as Record<ScoredArm, ArmScore>;
  return { embedder: embedder.model, cases, arms, noiseRejected: ratio(rejected, noiseQueries.length) };
}

function score(cases: CaseResult[], arm: ScoredArm): ArmScore {
  const first = (r: CaseResult) => r.rank[arm] === 1;
  const passages = cases.filter((r) => r.case.passage !== undefined);
  const bodyOnly = cases.filter((r) => r.case.bodyOnly);
  return {
    recall: ratio(cases.filter((r) => r.rank[arm] !== null).length, cases.length),
    precisionAt1: ratio(cases.filter(first).length, cases.length),
    mrr: cases.reduce((sum, r) => sum + (r.rank[arm] ? 1 / r.rank[arm]! : 0), 0) / (cases.length || 1),
    passageAt1: ratio(passages.filter((r) => first(r) && r.heading[arm] === r.case.passage).length, passages.length),
    bodyOnlyAt1: ratio(bodyOnly.filter(first).length, bodyOnly.length),
  };
}

const ratio = (part: number, whole: number) => (whole ? part / whole : 0);
