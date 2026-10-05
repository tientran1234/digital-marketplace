/**
 * Reciprocal rank fusion on its own, and hybrid search against a real
 * Postgres with pgvector — the lexical arm is Postgres's own text search, so
 * there is nothing to assert about it without a database.
 *
 *   DATABASE_URL=… pnpm test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pool } from "@/lib/pg";
import { HashEmbedder, reciprocalRankFusion } from "@/rag";
import { searchProducts, type SearchHit } from "@/server/search";
import { indexSearchCorpus, runSearchEval, searchCases } from "../evals/search";

const ranked = (...keys: string[]) => keys.map((key) => ({ key }));

describe("reciprocal rank fusion", () => {
  it("prefers what both lists rank well over what one list ranks first", () => {
    const text = ranked("a", "c", "b");
    const vector = ranked("d", "c", "e");
    // "c" is first in neither list; nothing else is in both.
    const fused = reciprocalRankFusion([text, vector], (hit) => hit.key);
    expect(fused[0]!.key).toBe("c");
    expect(fused[0]!.ranks).toEqual([2, 2]);
  });

  it("scores an item only for the lists it appears in, and says which those were", () => {
    const fused = reciprocalRankFusion([ranked("a"), ranked("b", "a")], (hit) => hit.key, 10);
    const byKey = new Map(fused.map((f) => [f.key, f]));
    expect(byKey.get("a")!.score).toBeCloseTo(1 / 11 + 1 / 12, 12);
    expect(byKey.get("b")!.score).toBeCloseTo(1 / 11, 12);
    expect(byKey.get("b")!.ranks).toEqual([null, 1]);
  });

  it("keeps the copy from the list that ranked it best, so the snippet comes from there", () => {
    const text = [{ key: "a", from: "text" }];
    const vector = [{ key: "b", from: "vector" }, { key: "a", from: "vector" }];
    const fused = reciprocalRankFusion([text, vector], (hit) => hit.key);
    expect(fused.find((f) => f.key === "a")!.item.from).toBe("text");
  });

  it("pays a duplicated key once", () => {
    const [fused] = reciprocalRankFusion([ranked("a", "a")], (hit) => hit.key);
    expect(fused!.ranks).toEqual([1]);
    expect(fused!.score).toBeCloseTo(1 / 61, 12);
  });

  it("orders ties by key, so the same corpus searches the same way twice", () => {
    const fused = reciprocalRankFusion([ranked("b", "a")], (hit) => hit.key);
    expect(fused.map((f) => f.key)).toEqual(["b", "a"]);
    const tied = reciprocalRankFusion([ranked("b"), ranked("a")], (hit) => hit.key);
    expect(tied.map((f) => f.key)).toEqual(["a", "b"]);
  });

  it("returns nothing for no lists and for empty ones", () => {
    expect(reciprocalRankFusion([], (hit: { key: string }) => hit.key)).toEqual([]);
    expect(reciprocalRankFusion([[], []], (hit: { key: string }) => hit.key)).toEqual([]);
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("hybrid search", () => {
  const embedder = new HashEmbedder();
  let bySlug: Map<string, string>;
  const slugOf = (hits: SearchHit[]) => hits.map((h) => [...bySlug].find(([, id]) => id === h.productId)?.[0]);

  beforeAll(async () => {
    bySlug = await indexSearchCorpus(embedder);
  });
  afterAll(async () => {
    await db.$disconnect();
    await pool().end();
  });

  it("finds a listing by words that are only inside its document", async () => {
    // Nothing in either title or description says "dunning" or "grandfather".
    const hits = await searchProducts("dunning expired cards", { embedder });
    expect(slugOf(hits)[0]).toBe("saas-pricing-playbook");
    expect(hits[0]!.heading).toBe("Churn and downgrades");
  });

  it("stems, so a query in the wrong tense still matches the heading it belongs to", async () => {
    const hits = await searchProducts("archiving rules", { embedder, arms: ["text"] });
    expect(slugOf(hits)[0]).toBe("notion-second-brain-template");
    expect(hits[0]!.heading).toBe("Archive rules");
  });

  it("matches the listing's own text, with no passage to point at", async () => {
    const [hit] = await searchProducts("notion template", { embedder, arms: ["text"] });
    expect(bySlug.get("notion-second-brain-template")).toBe(hit!.productId);
    expect(hit!.heading).toBeNull();
  });

  it("records the rank each arm gave a hit, and null for an arm that missed it", async () => {
    const [hit] = await searchProducts("dunning expired cards", { embedder });
    expect(hit!.ranks).toEqual({ text: 1, vector: 1 });
    const [textOnly] = await searchProducts("dunning expired cards", { embedder, arms: ["text"] });
    expect(textOnly!.ranks).toEqual({ text: 1, vector: null });
  });

  it("returns nothing from the lexical arm for a query no document contains a word of", async () => {
    expect(await searchProducts("asdfghjkl qwertyuiop", { embedder, arms: ["text"] })).toEqual([]);
  });

  it("is not a search for everything when the query is empty", async () => {
    expect(await searchProducts("   ", { embedder })).toEqual([]);
  });

  it("leaves unpublished listings out, however well they match", async () => {
    const productId = bySlug.get("saas-pricing-playbook")!;
    await db.product.update({ where: { id: productId }, data: { status: "DRAFT" } });
    try {
      const hits = await searchProducts("dunning expired cards", { embedder });
      expect(hits.map((h) => h.productId)).not.toContain(productId);
    } finally {
      await db.product.update({ where: { id: productId }, data: { status: "PUBLISHED" } });
    }
  });

  /**
   * The floors for the search-relevance section of evals/README.md. Measured
   * 95% / 94.1% on the hash embedder, which leaves room for one more miss and
   * none for an arm that went dark.
   */
  it("meets the search-relevance floors", async () => {
    const report = await runSearchEval({ embedder });
    expect(report.cases).toHaveLength(searchCases.length);
    expect(report.arms.hybrid.precisionAt1).toBeGreaterThanOrEqual(0.9);
    expect(report.arms.hybrid.recall).toBe(1);
    expect(report.arms.hybrid.bodyOnlyAt1).toBeGreaterThanOrEqual(0.88);
    expect(report.arms.hybrid.passageAt1).toBeGreaterThanOrEqual(0.82);
    expect(report.noiseRejected).toBe(1);
    // Each arm on its own, so a fused number cannot hide one of them going dark.
    expect(report.arms.text.precisionAt1).toBeGreaterThanOrEqual(0.85);
    expect(report.arms.vector.recall).toBeGreaterThanOrEqual(0.95);
    // What fusing them is for: it never ranks a listing below the arm that
    // found it best. On two documents it can do no better than that — the
    // listing both arms put second stays second — so this is the regression
    // detector, not a benchmark.
    for (const c of report.cases) {
      const best = Math.min(...[c.rank.text, c.rank.vector].map((r) => r ?? Infinity));
      expect(c.rank.hybrid ?? Infinity, `${c.id}: fusion ranked it ${c.rank.hybrid}, best arm ${best}`).toBeLessThanOrEqual(best);
    }
  });
});
